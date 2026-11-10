import type {
  DataTableSettings,
  ListViewBody,
  ListViewTableMeta,
  PredefinedListViewId,
  PredefinedListViewTableSettings,
  SavedListView,
} from '@/interfaces'
import {
  isPredefinedListViewId,
} from '@/interfaces/listViews'
import {
  ALL_RECORDS_FILTER_ID,
} from '@/modules/config/services/listFilterSettings'
import { RECENTLY_VIEWED_FILTER_ID } from '@/modules/dashboard/services/recentRecords'
import {
  readSettingRecord,
  readSettingRecords,
  writeSettingDelete,
  writeSettingUpsert,
} from '@/core/graphql/settingRecordsBridge'
import { currentUserRole } from '@/core/currentUser'
import {
  normalizeSavedRoleScopedLayout,
  parseSettingRoleId,
} from '@/core/settingRoleUtils'
import {
  normalizeConditionFieldWidth,
  type ListFilterCondition,
  type SavedListFilter,
} from '@/modules/config/services/listFilterSettings'
import {
  buildDefaultTableSettings,
  normalizeTableSettings,
  saveTableSettings,
} from '@/modules/entities/services/tableSettings'

const SETTINGS_GROUP = 'list'
const VIEW_SUB_GROUP = 'table'
const META_SUB_GROUP = 'table_meta'
const LEGACY_FILTER_SUB_GROUP = 'full'

interface ListViewSettingRecord {
  id: number | string
  collection: string
  group: string
  name?: string | null
  sub_group: string
  role?: string | { id?: string | number; name?: string | null } | null
  body?: ListViewBody | DataTableSettings | string | null
}

interface LegacyFilterSettingsBody {
  filters?: SavedListFilter[]
}

export async function loadListViews(
  collection: string,
  roleId?: string | null,
): Promise<SavedListView[]> {
  let views = await readListViewRecords(collection, roleId)
  if (views.length === 0 && roleId === undefined) {
    await migrateLegacyListSettings(collection)
    views = await readListViewRecords(collection, roleId)
  }
  return views.sort((a, b) => a.name.localeCompare(b.name))
}

export async function resolveListViewsForCurrentUser(
  collection: string,
): Promise<SavedListView[]> {
  const roleId = await currentUserRole()
  const roleViews = await loadListViews(collection, roleId)
  if (roleId === null) {
    return roleViews
  }

  const defaultViews = await loadListViews(collection, null)
  const roleViewIds = new Set(roleViews.map((view) => view.id))
  const merged = [
    ...roleViews,
    ...defaultViews.filter((view) => !roleViewIds.has(view.id)),
  ]
  return merged.sort((a, b) => a.name.localeCompare(b.name))
}

/** Loads a saved list view by ID, scoped to the current user's role plus default-role views. */
export async function loadListView(
  collection: string,
  viewId: string,
): Promise<SavedListView | null> {
  const views = await resolveListViewsForCurrentUser(collection)
  return views.find((view) => view.id === String(viewId)) ?? null
}

export async function saveListView(
  collection: string,
  view: SavedListView,
): Promise<SavedListView> {
  const body = normalizeListViewBody({
    logic: view.logic,
    conditions: view.conditions,
    columns: view.columns,
    sort: view.sort ?? null,
    groupBy: view.groupBy ?? null,
    recordLinkField: view.recordLinkField ?? null,
  })

  const existing = view.id
    ? await readListViewRecordById(collection, view.id)
    : null

  const savedId = await writeSettingUpsert({
    settingId: existing ? String(existing.id) : null,
    entityApiName: collection,
    groupKey: SETTINGS_GROUP,
    subGroup: VIEW_SUB_GROUP,
    roleId: view.roleId ?? null,
    name: view.name.trim(),
    body: body as unknown as Record<string, unknown>,
  })

  return normalizeSavedListView(
    savedId,
    view.name,
    body,
    view.roleId ?? (existing ? parseSettingRoleId(existing.role) : null),
  )
}

export async function deleteListView(
  collection: string,
  viewId: string,
): Promise<void> {
  const existing = await readListViewRecordById(collection, viewId)
  if (!existing) return
  await writeSettingDelete(String(existing.id))
}

function emptyListViewTableMeta(): ListViewTableMeta {
  return {
    relatedTransfer: null,
    actions: null,
    detailPanel: null,
    inlineEditRefresh: 'off',
    inlineEditRefreshFields: [],
    barcodeScan: null,
    predefinedViews: {},
  }
}

function mergeRawPredefinedViews(
  base: NonNullable<ListViewTableMeta['predefinedViews']>,
  override: NonNullable<ListViewTableMeta['predefinedViews']>,
): NonNullable<ListViewTableMeta['predefinedViews']> {
  const merged: NonNullable<ListViewTableMeta['predefinedViews']> = { ...base }

  for (const viewId of [ALL_RECORDS_FILTER_ID, RECENTLY_VIEWED_FILTER_ID] as const) {
    const overrideEntry = override[viewId]
    if (!overrideEntry) continue

    const baseEntry = base[viewId]
    if (!baseEntry) {
      merged[viewId] = overrideEntry
      continue
    }

    merged[viewId] = {
      ...baseEntry,
      ...overrideEntry,
      recordLinkField: Object.prototype.hasOwnProperty.call(overrideEntry, 'recordLinkField')
        ? (overrideEntry.recordLinkField ?? null)
        : baseEntry.recordLinkField,
    }
  }

  return merged
}

function mergeListViewTableMeta(
  base: ListViewTableMeta,
  override: ListViewTableMeta,
): ListViewTableMeta {
  return {
    relatedTransfer: override.relatedTransfer ?? base.relatedTransfer ?? null,
    actions: override.actions ?? base.actions ?? null,
    detailPanel: override.detailPanel ?? base.detailPanel ?? null,
    inlineEditRefresh: override.inlineEditRefresh ?? base.inlineEditRefresh ?? 'off',
    inlineEditRefreshFields:
      override.inlineEditRefreshFields ?? base.inlineEditRefreshFields ?? [],
    // Same as relatedTransfer: null/omitted on a role record must not wipe default meta.
    barcodeScan: override.barcodeScan ?? base.barcodeScan ?? null,
    predefinedViews: normalizePredefinedViews(
      mergeRawPredefinedViews(
        base.predefinedViews ?? {},
        override.predefinedViews ?? {},
      ),
    ),
  }
}

export async function loadListViewTableMeta(
  collection: string,
  roleId?: string | null,
): Promise<ListViewTableMeta> {
  const resolvedRoleId =
    roleId === undefined ? await currentUserRole() : (roleId ?? null)

  const defaultRecord = await readMetaSettingRecord(collection, null)
  const defaultMeta = defaultRecord?.body
    ? parseListViewTableMeta(defaultRecord.body)
    : emptyListViewTableMeta()

  if (resolvedRoleId === null) {
    return defaultMeta
  }

  const roleRecord = await readMetaSettingRecord(collection, resolvedRoleId)
  if (!roleRecord?.body) {
    return defaultMeta
  }

  const roleMeta = parseListViewTableMeta(roleRecord.body)
  return mergeListViewTableMeta(defaultMeta, roleMeta)
}

export async function saveListViewTableMeta(
  collection: string,
  meta: ListViewTableMeta,
  roleId: string | null = null,
): Promise<void> {
  const existing = await readMetaSettingRecord(collection, roleId)
  const current = existing?.body ? parseListViewTableMeta(existing.body) : emptyListViewTableMeta()
  const body: ListViewTableMeta = {
    relatedTransfer:
      meta.relatedTransfer !== undefined
        ? (meta.relatedTransfer ?? null)
        : (current.relatedTransfer ?? null),
    actions:
      meta.actions !== undefined
        ? (meta.actions ?? null)
        : (current.actions ?? null),
    detailPanel:
      meta.detailPanel !== undefined
        ? (meta.detailPanel ?? null)
        : (current.detailPanel ?? null),
    inlineEditRefresh:
      meta.inlineEditRefresh !== undefined
        ? (meta.inlineEditRefresh ?? 'off')
        : (current.inlineEditRefresh ?? 'off'),
    inlineEditRefreshFields:
      meta.inlineEditRefreshFields !== undefined
        ? (meta.inlineEditRefreshFields ?? [])
        : (current.inlineEditRefreshFields ?? []),
    barcodeScan:
      meta.barcodeScan !== undefined
        ? (meta.barcodeScan ?? null)
        : (current.barcodeScan ?? null),
    predefinedViews: meta.predefinedViews ?? current.predefinedViews ?? {},
  }

  await writeSettingUpsert({
    settingId: existing ? String(existing.id) : null,
    entityApiName: collection,
    groupKey: SETTINGS_GROUP,
    subGroup: META_SUB_GROUP,
    roleId,
    name: collection,
    body: body as unknown as Record<string, unknown>,
  })
}

export async function resolvePredefinedViewTableSettings(
  collection: string,
  viewId: PredefinedListViewId,
  meta?: ListViewTableMeta,
  roleId?: string | null,
): Promise<DataTableSettings> {
  const resolvedRoleId =
    roleId === undefined ? await currentUserRole() : (roleId ?? null)
  const resolvedMeta = meta ?? await loadListViewTableMeta(collection, resolvedRoleId)
  const saved = resolvedMeta.predefinedViews?.[viewId]

  if (saved?.columns?.length) {
    const normalized = normalizeTableSettings({
      columns: saved.columns,
      sort: saved.sort ?? null,
      groupBy: saved.groupBy ?? null,
      recordLinkField: saved.recordLinkField ?? null,
    })
    return applyListViewMetaToTableSettings(normalized, resolvedMeta)
  }

  const defaults = await buildDefaultTableSettings(collection)
  return applyListViewMetaToTableSettings(defaults, resolvedMeta)
}

function applyListViewMetaToTableSettings(
  settings: DataTableSettings,
  meta: ListViewTableMeta | null | undefined,
): DataTableSettings {
  const refresh = meta?.inlineEditRefresh === 'row' || meta?.inlineEditRefresh === 'fields'
    ? meta.inlineEditRefresh
    : undefined
  const refreshFields =
    refresh === 'fields' && Array.isArray(meta?.inlineEditRefreshFields)
      ? meta.inlineEditRefreshFields.filter((field) => String(field ?? '').trim())
      : undefined
  return {
    ...settings,
    relatedTransfer: meta?.relatedTransfer ?? null,
    actions: meta?.actions ?? null,
    detailPanel: meta?.detailPanel ?? null,
    barcodeScan: meta?.barcodeScan ?? null,
    ...(refresh ? { inlineEditRefresh: refresh } : {}),
    ...(refreshFields?.length ? { inlineEditRefreshFields: refreshFields } : {}),
  }
}

export async function savePredefinedViewTableSettings(
  collection: string,
  viewId: PredefinedListViewId,
  settings: Pick<
    DataTableSettings,
    | 'columns'
    | 'sort'
    | 'groupBy'
    | 'recordLinkField'
    | 'inlineEditRefresh'
    | 'inlineEditRefreshFields'
  >,
  roleId: string | null = null,
): Promise<void> {
  const meta = await loadListViewTableMeta(collection, roleId)
  const normalized = normalizeTableSettings(settings)
  const predefinedViews = {
    ...meta.predefinedViews,
    [viewId]: {
      columns: normalized.columns,
      sort: normalized.sort ?? null,
      groupBy: normalized.groupBy ?? null,
      recordLinkField: normalized.recordLinkField ?? null,
    } satisfies PredefinedListViewTableSettings,
  }

  await saveListViewTableMeta(collection, {
    ...meta,
    predefinedViews,
    inlineEditRefresh: normalized.inlineEditRefresh ?? 'off',
    inlineEditRefreshFields: normalized.inlineEditRefreshFields ?? [],
  }, roleId)
}

export { ALL_RECORDS_FILTER_ID, RECENTLY_VIEWED_FILTER_ID, isPredefinedListViewId }

export function listViewToTableSettings(
  view: Pick<SavedListView, 'columns' | 'sort' | 'groupBy' | 'recordLinkField'>,
  meta?: ListViewTableMeta | null,
): DataTableSettings {
  const normalized = normalizeTableSettings({
    columns: view.columns,
    sort: view.sort ?? null,
    groupBy: view.groupBy ?? null,
    recordLinkField: view.recordLinkField ?? null,
  })
  return applyListViewMetaToTableSettings(normalized, meta)
}

export async function resolvePinnedListViewId(
  collection: string,
  pinnedId: string | null,
): Promise<string | null> {
  if (!pinnedId) return null

  // Predefined views (All records / Recently Viewed) are valid pin targets.
  if (isPredefinedListViewId(pinnedId)) {
    return pinnedId
  }

  const views = await resolveListViewsForCurrentUser(collection)
  if (views.some((view) => view.id === pinnedId)) {
    return pinnedId
  }

  if (!pinnedId.startsWith('list_filter_')) {
    return null
  }

  const legacyFilters = await readLegacyListFilters(collection)
  const legacyFilter = legacyFilters.find((filter) => filter.id === pinnedId)
  if (!legacyFilter) return null

  const matched = views.find((view) => view.name === legacyFilter.name)
  return matched?.id ?? null
}

export async function migrateLegacyListSettings(collection: string): Promise<void> {
  const [legacyFilters, legacyTable, legacyTableRecord] = await Promise.all([
    readLegacyListFilters(collection),
    readLegacySingletonTableSettings(collection),
    readLegacySingletonTableRecord(collection),
  ])

  const defaultColumns =
    legacyTable?.columns?.length
      ? legacyTable.columns
      : (await buildDefaultTableSettings(collection)).columns
  const defaultSort = legacyTable?.sort ?? null

  if (legacyFilters.length > 0) {
    for (const filter of legacyFilters) {
      const body = normalizeListViewBody({
        logic: filter.logic,
        conditions: filter.conditions,
        columns: defaultColumns,
        sort: defaultSort,
      })
      await writeSettingUpsert({
        settingId: null,
        entityApiName: collection,
        groupKey: SETTINGS_GROUP,
        subGroup: VIEW_SUB_GROUP,
        name: filter.name,
        body: body as unknown as Record<string, unknown>,
      })
    }
  } else if (legacyTable?.columns?.length) {
    const body = normalizeListViewBody({
      logic: 'and',
      conditions: [],
      columns: legacyTable.columns,
      sort: legacyTable.sort ?? null,
    })
    await writeSettingUpsert({
      settingId: null,
      entityApiName: collection,
      groupKey: SETTINGS_GROUP,
      subGroup: VIEW_SUB_GROUP,
      name: collection,
      body: body as unknown as Record<string, unknown>,
    })
  }

  if (legacyTable?.relatedTransfer) {
    await saveListViewTableMeta(collection, {
      relatedTransfer: legacyTable.relatedTransfer,
    })
  }

  if (legacyTable) {
    await saveTableSettings(collection, legacyTable)
  }

  if (legacyTableRecord) {
    await writeSettingDelete(String(legacyTableRecord.id))
  }
}

async function readListViewRecords(
  collection: string,
  roleId?: string | null,
): Promise<SavedListView[]> {
  const records = await readSettingRecords<ListViewSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP],
    subGroup: VIEW_SUB_GROUP,
    ...(roleId !== undefined ? { roleId } : {}),
  })

  return records
    .filter((record) => isListViewBody(record.body))
    .map((record) =>
      normalizeSavedListView(
        record.id,
        record.name?.trim() || String(record.id),
        parseListViewBody(record.body as ListViewSettingRecord['body']),
        record.role,
      ),
    )
}

async function readListViewRecordById(
  collection: string,
  viewId: string,
): Promise<ListViewSettingRecord | null> {
  return readSettingRecord<ListViewSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP],
    subGroup: VIEW_SUB_GROUP,
    id: viewId,
    limit: 1,
  })
}

async function readMetaSettingRecord(
  collection: string,
  roleId: string | null = null,
): Promise<ListViewSettingRecord | null> {
  return readSettingRecord<ListViewSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP],
    subGroup: META_SUB_GROUP,
    roleId,
    limit: 1,
  })
}

async function readLegacyListFilters(collection: string): Promise<SavedListFilter[]> {
  const record = await readSettingRecord<ListViewSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP],
    subGroup: LEGACY_FILTER_SUB_GROUP,
    limit: 1,
  })

  const body = record?.body as
    | LegacyFilterSettingsBody
    | SavedListFilter[]
    | string
    | null
    | undefined
  if (!body) return []

  const parsed =
    typeof body === 'string'
      ? (JSON.parse(body) as LegacyFilterSettingsBody | SavedListFilter[])
      : body

  const filters = Array.isArray(parsed) ? parsed : (parsed.filters ?? [])
  return filters.map((filter) => ({
    id: filter.id,
    name: filter.name,
    logic: filter.logic,
    conditions: filter.conditions.map(normalizeListFilterCondition),
  }))
}

async function readLegacySingletonTableRecord(
  collection: string,
): Promise<ListViewSettingRecord | null> {
  const record = await readSettingRecord<ListViewSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP],
    subGroup: VIEW_SUB_GROUP,
    limit: 1,
  })

  if (!record) return null
  if (isListViewBody(record.body)) return null
  return record as ListViewSettingRecord
}

async function readLegacySingletonTableSettings(
  collection: string,
): Promise<DataTableSettings | null> {
  const record = await readLegacySingletonTableRecord(collection)
  if (!record?.body) return null

  const body =
    typeof record.body === 'string'
      ? (JSON.parse(record.body) as DataTableSettings)
      : record.body

  return normalizeTableSettings(body)
}

function isListViewBody(body: unknown): body is ListViewBody {
  if (!body || typeof body !== 'object') return false
  const candidate = body as ListViewBody
  return Array.isArray(candidate.columns) && typeof candidate.logic === 'string'
}

function parseListViewBody(body: ListViewSettingRecord['body']): ListViewBody {
  const parsed =
    typeof body === 'string'
      ? (JSON.parse(body) as ListViewBody)
      : (body as ListViewBody)

  return normalizeListViewBody(parsed)
}

function parseListViewTableMeta(body: unknown): ListViewTableMeta {
  const parsed =
    typeof body === 'string'
      ? (JSON.parse(body) as ListViewTableMeta)
      : (body as ListViewTableMeta)

  const normalizedExtras = normalizeTableSettings({
    columns: [],
    actions: parsed.actions ?? null,
    detailPanel: parsed.detailPanel ?? null,
    inlineEditRefresh: parsed.inlineEditRefresh,
    inlineEditRefreshFields: parsed.inlineEditRefreshFields,
    barcodeScan: parsed.barcodeScan ?? null,
  })
  return {
    relatedTransfer: parsed.relatedTransfer ?? null,
    actions: normalizedExtras.actions,
    detailPanel: normalizedExtras.detailPanel,
    inlineEditRefresh: normalizedExtras.inlineEditRefresh ?? 'off',
    inlineEditRefreshFields: normalizedExtras.inlineEditRefreshFields ?? [],
    barcodeScan: normalizedExtras.barcodeScan ?? null,
    predefinedViews: normalizePredefinedViews(parsed.predefinedViews),
  }
}

function normalizePredefinedViews(
  views: ListViewTableMeta['predefinedViews'],
): ListViewTableMeta['predefinedViews'] {
  if (!views || typeof views !== 'object') return {}

  const normalized: NonNullable<ListViewTableMeta['predefinedViews']> = {}

  for (const viewId of [ALL_RECORDS_FILTER_ID, RECENTLY_VIEWED_FILTER_ID] as const) {
    const entry = views[viewId]
    if (!entry?.columns?.length) continue
    const table = normalizeTableSettings({
      columns: entry.columns,
      sort: entry.sort ?? null,
      groupBy: entry.groupBy ?? null,
      recordLinkField: entry.recordLinkField ?? null,
    })
    normalized[viewId] = {
      columns: table.columns,
      sort: table.sort ?? null,
      groupBy: table.groupBy ?? null,
      recordLinkField: table.recordLinkField ?? null,
    }
  }

  return normalized
}

function normalizeListViewBody(body: ListViewBody): ListViewBody {
  const table = normalizeTableSettings({
    columns: body.columns,
    sort: body.sort ?? null,
    groupBy: body.groupBy ?? null,
    recordLinkField: body.recordLinkField ?? null,
  })

  return {
    logic: body.logic === 'or' ? 'or' : 'and',
    conditions: Array.isArray(body.conditions)
      ? body.conditions.map(normalizeListFilterCondition)
      : [],
    columns: table.columns,
    sort: table.sort ?? null,
    groupBy: table.groupBy ?? null,
    recordLinkField: table.recordLinkField ?? null,
  }
}

function normalizeListFilterCondition(condition: ListFilterCondition): ListFilterCondition {
  return {
    id: condition.id,
    field: condition.field,
    operator: condition.operator,
    value: condition.value,
    ...(condition.type ? { type: condition.type } : {}),
    ...(condition.userVisible === false ? { userVisible: false } : {}),
    ...(condition.required === true ? { required: true } : {}),
    ...(normalizeConditionFieldWidth(condition.fieldWidth)
      ? { fieldWidth: normalizeConditionFieldWidth(condition.fieldWidth)! }
      : {}),
  }
}

function normalizeSavedListView(
  id: number | string,
  name: string,
  body: ListViewBody,
  role: ListViewSettingRecord['role'] | string | null = null,
): SavedListView {
  const roleMeta =
    role && typeof role === 'object'
      ? normalizeSavedRoleScopedLayout({
          id,
          collection: '',
          group: SETTINGS_GROUP,
          sub_group: VIEW_SUB_GROUP,
          name,
          role,
        })
      : {
          roleId: typeof role === 'string' ? role : null,
          roleName: null as string | null,
        }

  return {
    id: String(id),
    name,
    roleId: roleMeta.roleId,
    roleName: roleMeta.roleName ?? null,
    logic: body.logic,
    conditions: body.conditions,
    columns: body.columns,
    sort: body.sort ?? null,
    groupBy: body.groupBy ?? null,
    recordLinkField: body.recordLinkField ?? null,
  }
}
