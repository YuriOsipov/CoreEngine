import type {
  DocTemplateListItem,
  DocTemplateOption,
  DocTemplateRecord,
  DocTemplateSaveInput,
} from '@/interfaces'
import { currentUserRole } from '@/core/currentUser'
import {
  bridgeCreateItem,
  bridgeReadItem,
  bridgeReadItems,
  bridgeUpdateItem,
} from '@/core/graphql/itemsBridge'
import { DOC_ARCHIVED_FIELD, DOC_TEMPLATE_BODY_FIELD, DOC_TEMPLATE_COLLECTION } from '@/interfaces/documents'
import { andFilters, notArchivedFilter } from './docArchiveFilter'
import {
  canAccessDocTemplate,
  docTemplateAccessFilter,
  parseDocTemplateRoleId,
  parseDocTemplateRoleName,
} from './docTemplateRole'

const LIST_FIELDS = [
  'id',
  'name',
  'description',
  'collection',
  'role',
  'role.id',
  'role.name',
  'is_active',
  'attach_file',
  'output_format',
  'hide_empty',
  DOC_ARCHIVED_FIELD,
  'date_created',
  'date_updated',
  'user_created.first_name',
  'user_created.last_name',
  'user_updated.first_name',
  'user_updated.last_name',
] as const

const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  DOC_TEMPLATE_BODY_FIELD,
  'field_mapping',
] as const

const SAVE_RETURN_FIELDS = [
  'id',
  'name',
  'description',
  'collection',
  'role',
  'is_active',
  'attach_file',
  'output_format',
  'hide_empty',
  DOC_TEMPLATE_BODY_FIELD,
  'field_mapping',
  DOC_ARCHIVED_FIELD,
] as const

function formatUserName(
  user: DocTemplateRecord['user_updated'],
): string | null {
  if (!user || typeof user === 'string') return null
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

function toListItem(record: DocTemplateRecord): DocTemplateListItem {
  return {
    id: String(record.id),
    name: record.name,
    description: record.description ?? null,
    collection: record.collection ?? null,
    roleId: parseDocTemplateRoleId(record.role),
    roleName: parseDocTemplateRoleName(record.role),
    dateCreated: record.date_created ?? null,
    dateUpdated: record.date_updated ?? null,
    userCreatedName: formatUserName(record.user_created),
    userUpdatedName: formatUserName(record.user_updated),
  }
}

export type DocTemplateListScope = 'setup' | 'runtime'

export async function loadDocTemplateListItems(
  collection: string,
  scope: DocTemplateListScope = 'setup',
): Promise<DocTemplateListItem[]> {
  const roleId = scope === 'runtime' ? await currentUserRole() : null
  const accessFilter = scope === 'runtime' ? docTemplateAccessFilter(roleId) : {}

  const records = (await bridgeReadItems(DOC_TEMPLATE_COLLECTION, {
    filter: andFilters(
      { collection: { _eq: collection } },
      notArchivedFilter(),
      accessFilter,
      scope === 'runtime' ? { is_active: { _neq: false } } : {},
    ),
    fields: [...LIST_FIELDS],
    sort: ['name'],
    limit: -1,
  })) as unknown as DocTemplateRecord[]

  return records.map(toListItem)
}

/** All non-archived templates (App Setup Document Templates). */
export async function loadAllDocTemplateListItems(
  scope: DocTemplateListScope = 'setup',
): Promise<DocTemplateListItem[]> {
  const roleId = scope === 'runtime' ? await currentUserRole() : null
  const accessFilter = scope === 'runtime' ? docTemplateAccessFilter(roleId) : {}

  const records = (await bridgeReadItems(DOC_TEMPLATE_COLLECTION, {
    filter: andFilters(notArchivedFilter(), accessFilter),
    fields: [...LIST_FIELDS],
    sort: ['collection', 'name'],
    limit: -1,
  })) as unknown as DocTemplateRecord[]

  return records.map(toListItem)
}

/** Non-archived templates available for runtime document actions (role-filtered). */
export async function loadPublishedDocTemplateOptions(
  collection: string,
): Promise<DocTemplateOption[]> {
  return loadDocTemplateListItems(collection, 'runtime').then((items) =>
    items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description ?? null,
    })),
  )
}

export async function loadDocTemplateById(
  templateId: string,
): Promise<DocTemplateRecord | null> {
  try {
    const record = (await bridgeReadItem(DOC_TEMPLATE_COLLECTION, templateId, {
      fields: [...DETAIL_FIELDS],
    })) as unknown as DocTemplateRecord
    return record
  } catch {
    return null
  }
}

/** Loads a template only when the current user's role may access it. */
export async function loadDocTemplateByIdForCurrentUser(
  templateId: string,
): Promise<DocTemplateRecord | null> {
  const record = await loadDocTemplateById(templateId)
  if (!record) return null

  const roleId = await currentUserRole()
  if (!canAccessDocTemplate(record, roleId)) return null

  return record
}

export async function saveDocTemplate(
  input: DocTemplateSaveInput,
  templateId?: string | null,
): Promise<DocTemplateRecord> {
  const payload: Record<string, unknown> = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    collection: input.collection,
    role: input.roleId ?? null,
    [DOC_TEMPLATE_BODY_FIELD]: input.body,
    field_mapping: input.field_mapping ?? null,
    is_active: input.isActive !== false,
    attach_file: input.attachFile !== false,
    output_format: input.outputFormat === 'html' ? 'html' : 'pdf',
    hide_empty: input.hideEmpty === true,
  }

  if (input.sort != null) {
    payload.sort = input.sort
  }

  const fields = [...SAVE_RETURN_FIELDS]

  let saved: DocTemplateRecord
  if (templateId) {
    saved = (await bridgeUpdateItem(
      DOC_TEMPLATE_COLLECTION,
      templateId,
      payload,
      { fields },
    )) as unknown as DocTemplateRecord
  } else {
    payload[DOC_ARCHIVED_FIELD] = false
    saved = (await bridgeCreateItem(DOC_TEMPLATE_COLLECTION, payload, {
      fields,
    })) as unknown as DocTemplateRecord
  }

  try {
    const { createSnapshotFromTemplateRecord } = await import(
      './docTemplateSnapshotService'
    )
    await createSnapshotFromTemplateRecord(saved)
  } catch {
    // Snapshot is best-effort for older DBs; fill Finish can still create one.
  }

  return saved
}

export async function deleteDocTemplate(templateId: string): Promise<void> {
  await bridgeUpdateItem(DOC_TEMPLATE_COLLECTION, templateId, {
    [DOC_ARCHIVED_FIELD]: true,
  })
}
