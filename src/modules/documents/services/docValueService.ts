import type { DocValueListItem, DocValueRecord, DocValueSaveInput } from '@/interfaces'
import { currentUserRole } from '@/core/currentUser'
import {
  bridgeCreateItem,
  bridgeReadItem,
  bridgeReadItems,
  bridgeUpdateItem,
} from '@/core/graphql/itemsBridge'
import {
  DOC_ARCHIVED_FIELD,
  DOC_DOCUMENT_STATUS_DRAFT,
  DOC_VALUE_COLLECTION,
  normalizeDocDocumentStatus,
  resolveDocOutputFileId,
} from '@/interfaces/documents'
import { andFilters, notArchivedFilter } from './docArchiveFilter'
import { canAccessDocTemplate } from './docTemplateRole'
import { resolveDocTemplateSnapshotId } from './docTemplateSnapshotService'
import {
  buildDocValueParentFilter,
  buildDocValueParentPayload,
} from './docValueParentLink'

const LIST_FIELDS = [
  'id',
  'template',
  'template.id',
  'template.name',
  'template.role',
  'template.role.id',
  'template_snapshot',
  'visit',
  'parent_collection',
  'parent_id',
  'document_status',
  'completed_date',
  'output_file',
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
  'values',
  'template_snapshot.id',
  'template_snapshot.body',
  'template_snapshot.field_mapping',
  'template_snapshot.version',
  'template_snapshot.template',
] as const

const SAVE_RETURN_FIELDS = [
  'id',
  'template',
  'template_snapshot',
  'visit',
  'parent_collection',
  'parent_id',
  'values',
  'document_status',
  'completed_date',
  'output_file',
  DOC_ARCHIVED_FIELD,
] as const

function formatUserName(
  user: DocValueRecord['user_updated'],
): string | null {
  if (!user || typeof user === 'string') return null
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

export function resolveDocValueTemplateId(
  template: DocValueRecord['template'],
): string | null {
  if (!template) return null
  if (typeof template === 'string') return template
  return template.id ? String(template.id) : null
}

function resolveDocValueLabel(record: DocValueRecord): string {
  if (record.template && typeof record.template === 'object' && record.template.name) {
    return record.template.name
  }
  return `#${record.id}`
}

function toListItem(record: DocValueRecord): DocValueListItem {
  return {
    id: String(record.id),
    label: resolveDocValueLabel(record),
    templateId: resolveDocValueTemplateId(record.template),
    documentStatus: normalizeDocDocumentStatus(record.document_status),
    completedDate: record.completed_date ?? null,
    outputFileId: resolveDocOutputFileId(record.output_file),
    dateCreated: record.date_created ?? null,
    dateUpdated: record.date_updated ?? null,
    userCreatedName: formatUserName(record.user_created),
    userUpdatedName: formatUserName(record.user_updated),
  }
}

export async function loadDocValueListItems(
  parentCollection: string,
  parentId: string,
  templateId?: string | null,
): Promise<DocValueListItem[]> {
  const roleId = await currentUserRole()
  const templateFilter =
    templateId && templateId.trim()
      ? { template: { _eq: templateId.trim() } }
      : {}

  const records = (await bridgeReadItems(DOC_VALUE_COLLECTION, {
    filter: andFilters(
      buildDocValueParentFilter(parentCollection, parentId),
      templateFilter,
      notArchivedFilter(),
    ),
    fields: [...LIST_FIELDS],
    sort: ['-date_updated'],
    limit: -1,
  })) as unknown as DocValueRecord[]

  return records
    .filter((record) => {
      const template = record.template
      if (!template || typeof template !== 'object') {
        return true
      }
      return canAccessDocTemplate(template, roleId)
    })
    .map(toListItem)
}

/** @deprecated Use loadDocValueListItems */
export async function loadDocValuesForRecord(
  parentCollection: string,
  parentId: string,
): Promise<DocValueRecord[]> {
  const records = (await bridgeReadItems(DOC_VALUE_COLLECTION, {
    filter: andFilters(
      buildDocValueParentFilter(parentCollection, parentId),
      notArchivedFilter(),
    ),
    fields: [...DETAIL_FIELDS],
    sort: ['-date_updated'],
    limit: -1,
  })) as unknown as DocValueRecord[]

  return records
}

export async function loadDocValueById(
  docValueId: string,
): Promise<DocValueRecord | null> {
  try {
    const record = (await bridgeReadItem(DOC_VALUE_COLLECTION, docValueId, {
      fields: [...DETAIL_FIELDS],
    })) as unknown as DocValueRecord
    return record
  } catch {
    return null
  }
}

export async function saveDocValue(
  input: DocValueSaveInput,
  docValueId?: string | null,
): Promise<DocValueRecord> {
  const payload: Record<string, unknown> = {
    template: input.templateId,
    ...buildDocValueParentPayload(input.parentCollection, input.parentId),
    values: input.values,
    document_status: input.documentStatus,
  }

  if (input.templateSnapshotId) {
    payload.template_snapshot = input.templateSnapshotId
  }

  if (input.documentStatus === 'completed') {
    payload.completed_date = input.completedDate ?? new Date().toISOString()
  }

  if (input.outputFileId !== undefined) {
    payload.output_file = input.outputFileId
  }

  const fields = [...SAVE_RETURN_FIELDS]

  if (docValueId) {
    const existing = await loadDocValueById(docValueId)
    if (existing) {
      const existingStatus = normalizeDocDocumentStatus(existing.document_status)
      if (
        existingStatus === 'completed' &&
        input.documentStatus === DOC_DOCUMENT_STATUS_DRAFT
      ) {
        throw new Error('Completed documents cannot be saved as draft.')
      }
      // Never retarget a pinned snapshot.
      const pinned = resolveDocTemplateSnapshotId(existing.template_snapshot)
      if (pinned) {
        payload.template_snapshot = pinned
      }
    }

    return (await bridgeUpdateItem(DOC_VALUE_COLLECTION, docValueId, payload, {
      fields,
    })) as unknown as DocValueRecord
  }

  payload[DOC_ARCHIVED_FIELD] = false
  if (!payload.document_status) {
    payload.document_status = DOC_DOCUMENT_STATUS_DRAFT
  }

  return (await bridgeCreateItem(DOC_VALUE_COLLECTION, payload, {
    fields,
  })) as unknown as DocValueRecord
}

export async function archiveDocValue(docValueId: string): Promise<void> {
  await bridgeUpdateItem(DOC_VALUE_COLLECTION, docValueId, {
    [DOC_ARCHIVED_FIELD]: true,
  })
}
