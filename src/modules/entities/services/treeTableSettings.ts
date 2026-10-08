import type { RoleLayoutSaveOptions, SavedRoleScopedLayout, TreeTableSettings } from '@/interfaces'
import {
  readSettingRecord,
  readSettingRecords,
  writeSettingDelete,
  writeSettingUpsert,
} from '@/core/graphql/settingRecordsBridge'
import { currentUserRole } from '@/core/currentUser'
import {
  DuplicateRoleScopedLayoutError,
  normalizeSavedRoleScopedLayout,
  parseSettingRoleId,
  sortRoleScopedLayouts,
} from '@/core/settingRoleUtils'

const SETTINGS_GROUP = 'Tree'
const SETTINGS_SUB_GROUP = 'full'

interface TreeTableSettingRecord {
  id: number | string
  collection: string
  group: string
  name?: string | null
  sub_group: string
  role?: string | { id?: string | number; name?: string | null } | null
  body?: TreeTableSettings | string | null
}

export async function loadTreeTableLayouts(
  itemCollection: string,
): Promise<SavedRoleScopedLayout[]> {
  const records = await readTreeTableSettingRecords(itemCollection)
  return sortRoleScopedLayouts(records.map((record) => normalizeSavedRoleScopedLayout(record)))
}

/** Builder/setup only — loads a tree layout by record ID without role scoping. */
export async function loadTreeTableSettingsById(
  itemCollection: string,
  layoutId: string,
): Promise<TreeTableSettings | null> {
  const record = await readTreeTableSettingRecordById(itemCollection, layoutId)
  return parseTreeTableBody(record)
}

export async function resolveTreeTableSettingsForRole(
  itemCollection: string,
  roleId: string | null,
): Promise<TreeTableSettings | null> {
  const record = await resolveTreeTableSettingRecord(itemCollection, roleId)
  return parseTreeTableBody(record)
}

export async function resolveTreeTableSettingsForCurrentUser(
  itemCollection: string,
): Promise<TreeTableSettings | null> {
  return resolveTreeTableSettingsForRole(itemCollection, await currentUserRole())
}

export async function loadTreeTableSettings(
  itemCollection: string,
): Promise<TreeTableSettings | null> {
  return resolveTreeTableSettingsForCurrentUser(itemCollection)
}

export async function saveTreeTableSettings(
  settings: TreeTableSettings,
  options?: RoleLayoutSaveOptions,
): Promise<SavedRoleScopedLayout> {
  const body = normalizeTreeTableSettings(settings)
  if (!body.main.collection) {
    throw new Error('Tree table item collection is required.')
  }

  const collection = body.main.collection
  const resolvedOptions: RoleLayoutSaveOptions = options ?? {
    layoutId: null,
    name: collection,
    roleId: null,
  }
  const name = resolvedOptions.name.trim()
  if (!name) {
    throw new Error('Tree layout name is required.')
  }

  const roleId = resolvedOptions.roleId ?? null
  const layouts = await loadTreeTableLayouts(collection)
  const layoutId = resolvedOptions.layoutId ?? null
  const duplicate = layouts.find(
    (layout) => layout.roleId === roleId && layout.id !== String(layoutId ?? ''),
  )
  if (duplicate) {
    throw new DuplicateRoleScopedLayoutError()
  }

  const existing = layoutId
    ? await readTreeTableSettingRecordById(collection, String(layoutId))
    : null

  const savedId = await writeSettingUpsert({
    settingId: existing ? String(existing.id) : null,
    entityApiName: collection,
    groupKey: SETTINGS_GROUP,
    subGroup: SETTINGS_SUB_GROUP,
    roleId,
    name,
    body: body as unknown as Record<string, unknown>,
  })

  return {
    id: savedId,
    name,
    roleId,
    roleName: layouts.find((layout) => layout.roleId === roleId)?.roleName ?? null,
  }
}

export async function deleteTreeTableLayout(
  itemCollection: string,
  layoutId: string,
): Promise<void> {
  const existing = await readTreeTableSettingRecordById(itemCollection, layoutId)
  if (!existing) return

  if (parseSettingRoleId(existing.role) === null) {
    throw new Error('Cannot delete the default tree layout')
  }

  await writeSettingDelete(String(existing.id))
}

export function normalizeTreeTableSettings(
  settings: Partial<TreeTableSettings> & Record<string, any> | null | undefined,
): TreeTableSettings {
  const group = (settings?.group ?? {}) as Partial<TreeTableSettings['group']>
  const main = (settings?.main ?? {}) as Partial<TreeTableSettings['main']>
  const destination = (settings?.destination ?? {}) as Partial<
    TreeTableSettings['destination']
  >

  return {
    group: {
      collection: group.collection ?? settings?.groupCollection ?? '',
      primaryKey: group.primaryKey ?? settings?.groupPrimaryKey ?? 'id',
      parentField: group.parentField ?? settings?.groupParentField ?? null,
      labelField: group.labelField ?? settings?.groupLabelField ?? 'name',
    },
    main: {
      collection: main.collection ?? settings?.itemCollection ?? '',
      groupField: main.groupField ?? settings?.itemGroupField ?? '',
      primaryKey: main.primaryKey ?? settings?.itemPrimaryKey ?? 'id',
      labelField: main.labelField ?? settings?.itemLabelField ?? 'name',
      labelFields: normalizeLabelFields(
        main.labelFields,
        main.labelField ?? settings?.itemLabelField,
      ),
    },
    destination: {
      collection: destination.collection ?? '',
      key: destination.key ?? settings?.destinationKey ?? 'items',
    },
  }
}

function normalizeLabelFields(
  labelFields: unknown,
  fallback?: string,
): string[] {
  const fields = Array.isArray(labelFields)
    ? labelFields.filter((field): field is string => typeof field === 'string')
    : []

  if (fields.length > 0) return fields
  return [fallback || 'name']
}

function parseTreeTableBody(record: TreeTableSettingRecord | null): TreeTableSettings | null {
  if (!record?.body) return null

  const body =
    typeof record.body === 'string'
      ? (JSON.parse(record.body) as TreeTableSettings)
      : record.body

  return normalizeTreeTableSettings(body)
}

async function resolveTreeTableSettingRecord(
  itemCollection: string,
  roleId: string | null,
): Promise<TreeTableSettingRecord | null> {
  if (roleId) {
    const roleMatch = await readTreeTableSettingRecordByRole(itemCollection, roleId)
    if (roleMatch) return roleMatch
  }

  return readTreeTableSettingRecordByRole(itemCollection, null)
}

async function readTreeTableSettingRecords(
  itemCollection: string,
): Promise<TreeTableSettingRecord[]> {
  return readSettingRecords<TreeTableSettingRecord>({
    collection: itemCollection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
  })
}

async function readTreeTableSettingRecordById(
  itemCollection: string,
  layoutId: string,
): Promise<TreeTableSettingRecord | null> {
  return readSettingRecord<TreeTableSettingRecord>({
    collection: itemCollection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
    id: layoutId,
    limit: 1,
  })
}

async function readTreeTableSettingRecordByRole(
  itemCollection: string,
  roleId: string | null,
): Promise<TreeTableSettingRecord | null> {
  return readSettingRecord<TreeTableSettingRecord>({
    collection: itemCollection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
    roleId,
    limit: 1,
  })
}
