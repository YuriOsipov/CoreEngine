import { currentUserRole } from '@/core/currentUser'
import { getEffectiveSetupAccess } from '@/core/setupAccess'
import { formatLocalDate, toDate } from '@/core/dateFormatting'
import { canReadEntity, ensureEntityPermissions } from '@/core/entityPermissions'
import {
  readSettingRecord,
  readSettingRecords,
  writeSettingDelete,
  writeSettingUpsert,
} from '@/core/graphql/settingRecordsBridge'
import { bridgeReadItems } from '@/core/graphql/itemsBridge'
import { parseSettingRoleId } from '@/core/settingRoleUtils'
import type {
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import {
  fetchCollectionDisplayTemplate,
  getCachedCollectionFields,
  getCachedFields,
  getCachedRelations,
  translatedFieldLabel,
} from '@/modules/entities/services/collectionSchema'
import { listFilterableFields, type FilterLogic } from '@/modules/config/services/listFilterSettings'
import type { PrimeVueComponentType } from '@/interfaces'
import {
  findRelationForField,
  mapFieldTypeToComponent,
  normalizeSpecial,
} from '@/modules/entities/utils/fieldMapper'
import {
  buildChoiceLabelMap,
  choiceValueLabel,
  extractTemplateFields,
  getPathValue,
  humanizeFieldName,
  relatedRecordDisplayField,
  relatedRecordFallbackLabel,
  renderTemplateLabel,
  setPathValue,
  shouldUseTemplateForRelatedLabel,
} from '@/modules/entities/utils/recordDisplay'
import {
  defaultDateGrainForField,
  normalizePivotDateGrain,
  type ReportDateGrain,
} from './reportDateGrain'

const SETTINGS_GROUP = 'report'
const SETTINGS_SUB_GROUP = 'full'
const FOLDER_SUB_GROUP = 'folder'
const FOLDER_ENTITY_API_NAME = '_report_folder'

export type ReportAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'
export type ReportSummaryAggregate = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'median'
export type ReportSortDirection = 'asc' | 'desc'
/** Reports are tabular-only; legacy `pivot` normalizes to tabular on load. */
export type ReportType = 'tabular'
export type { ReportDateGrain }

export interface ReportFilterCondition {
  id: string
  field: string
  operator: string
  value: unknown
  /**
   * When true, end users can change the value on the runtime report page
   * without editing the saved report definition.
   */
  visibleInRuntime?: boolean
}

export interface ReportPivotValue {
  field: string
  aggregate: ReportAggregate
}

export interface ReportPivotDimension {
  field: string
  sort?: ReportSortDirection
  /** When set, date/datetime values are bucketed (Day / Week / Month / Quarter / Year). */
  dateGrain?: ReportDateGrain | null
}

export interface ReportPivotSettings {
  rows: ReportPivotDimension[]
  columns: ReportPivotDimension[]
  values: ReportPivotValue[]
  /**
   * When set, order pivot rows by the row Total (first value aggregate)
   * instead of by row field labels.
   */
  sortRowsByTotal?: ReportSortDirection | null
}

export interface ReportTabularGroup {
  field: string
  sort?: ReportSortDirection
  /** When set, date/datetime values are bucketed (Day / Week / Month / Quarter / Year). */
  dateGrain?: ReportDateGrain | null
}

export interface ReportTabularColumn {
  field: string
  sort?: ReportSortDirection | null
  /** Column summaries (SF-style Summarize), including count. */
  summaries?: ReportSummaryAggregate[]
}

export interface ReportTabularSettings {
  columns: ReportTabularColumn[]
  groupRows: ReportTabularGroup[]
  groupColumns: ReportTabularGroup[]
  showDetailRows?: boolean
  showSubtotals?: boolean
  showGrandTotal?: boolean
  /**
   * When set, order matrix rows by the row Total (first value aggregate)
   * instead of by row field labels.
   */
  sortRowsByTotal?: ReportSortDirection | null
}

export interface ReportPivotPathSegment {
  field: string
  value: string
  dateGrain?: ReportDateGrain | null
}

export interface ReportPivotDrillDown {
  rowPath: ReportPivotPathSegment[]
  columnPath: ReportPivotPathSegment[]
  recordIds: Array<string | number>
}

export interface ReportDefinition {
  id: string
  name: string
  title: string
  collection: string
  /** Always tabular (legacy pivot reports migrate on normalize). */
  type: ReportType
  filterLogic: FilterLogic
  conditions: ReportFilterCondition[]
  pivot: ReportPivotSettings
  tabular: ReportTabularSettings
  limit?: number
  /** Folder id from report folder settings; null = unfiled. */
  folderId?: string | null
  /**
   * Persisted column widths (px), keyed by stable field identity
   * (`row:path`, `col:path`, `value:aggregate:path`, or tabular `field:path`).
   */
  columnWidths?: Record<string, number>
}

export const REPORT_FOLDER_MAX_DEPTH = 5

export interface ReportFolder {
  settingId: string
  id: string
  name: string
  /** Null/omit = root folder. */
  parentId?: string | null
}

interface ReportFolderBody {
  id: string
  name: string
  parentId?: string | null
}

export interface ReportSettingRecord {
  id: number | string
  collection: string
  group: string
  name: string
  sub_group: string
  role?: string | { id?: string | number; name?: string | null } | null
  body?: ReportDefinition | string | null
}

export interface ReportWithSetting {
  settingId: number | string
  name: string
  title: string
  collection: string
  /** Linked app role; null = visible to all roles (same as dashboards). */
  roleId: string | null
  config: ReportDefinition
}

export interface ReportFieldOption {
  field: string
  label: string
  type: string
  component: PrimeVueComponentType
  relatedCollection?: string
  sourceField?: string
  nestedField?: string
}

export interface ReportFieldTreeNode {
  key: string
  label: string
  leaf: boolean
  selectable: boolean
  data: ReportFieldOption
  children?: ReportFieldTreeNode[]
}

export interface ReportFieldTreeMetadata {
  fieldsByCollection: Map<string, FieldDefinition[]>
  relations: RelationDefinition[]
}

interface ReportM2OMetadata {
  collections: Map<string, string>
  displayFields: Map<string, string>
  templates: Map<string, string>
  choiceLabels: Map<string, Map<string, string>>
}

interface ReportQueryRequest {
  fields: string[]
  m2o: ReportM2OMetadata
}

interface ResolvedM2OField {
  field: FieldDefinition | undefined
  relatedCollection: string
  relatedFields: FieldDefinition[]
}

export async function listReports(): Promise<ReportWithSetting[]> {
  const records = await readSettingRecords<ReportSettingRecord>({
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
  })

  return records
    .map((record) => {
      const typed = record as ReportSettingRecord
      const config = normalizeReportDefinition(parseReportBody(typed), {
        name: typed.name,
        collection: typed.collection,
      })
      return {
        settingId: typed.id,
        name: typed.name,
        title: config.title || typed.name,
        collection: config.collection || typed.collection,
        roleId: parseSettingRoleId(typed.role),
        config,
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** Runtime list: role-scoped (like dashboards) and only collections the user can read. */
export async function listReportsForCurrentRole(): Promise<ReportWithSetting[]> {
  await ensureEntityPermissions()
  const roleId = await currentUserRole()
  const reports = await listReports()
  return reports.filter(
    (report) =>
      isReportVisibleToRole(report, roleId) &&
      (!report.collection || canReadEntity(report.collection)),
  )
}

/**
 * Setup list for report authors: admins see all; non-admin authors see only
 * reports locked to their own role (not global / other roles).
 */
export async function listReportsForAuthoring(): Promise<ReportWithSetting[]> {
  const access = await getEffectiveSetupAccess()
  const reports = await listReports()
  if (access.isFullSetupAdmin) return reports
  if (!access.canAuthorReports) return []
  const roleId = await currentUserRole()
  if (!roleId) return []
  return reports.filter((report) => String(report.roleId ?? '') === String(roleId))
}

export function isReportVisibleToRole(
  report: Pick<ReportWithSetting, 'roleId'>,
  roleId: string | null,
): boolean {
  if (report.roleId == null || report.roleId === '') return true
  if (roleId == null || roleId === '') return false
  return String(report.roleId) === String(roleId)
}

/** @deprecated Pivot type removed — always false after normalize. */
export function isPivotReport(_report?: Pick<ReportDefinition, 'type'>): boolean {
  return false
}

export function isTabularReport(_report?: Pick<ReportDefinition, 'type'>): boolean {
  return true
}

export function reportCanRun(report: ReportDefinition | null | undefined): boolean {
  if (!report?.collection) return false
  return report.tabular.columns.length > 0
}

export async function getReportBySettingId(
  settingId: string | number,
): Promise<ReportWithSetting | null> {
  const reports = await listReports()
  return reports.find((report) => String(report.settingId) === String(settingId)) ?? null
}

export async function deleteReport(settingId: string | number): Promise<void> {
  await writeSettingDelete(String(settingId))
}

export async function listReportFolders(): Promise<ReportFolder[]> {
  const records = await readSettingRecords({
    groups: [SETTINGS_GROUP],
    subGroup: FOLDER_SUB_GROUP,
  })

  const folders = records.map((record) => {
    const body = parseFolderBody(
      record.body as ReportFolderBody | string | null | undefined,
    )
    const id = String(body.id || record.id)
    const name = String(body.name || record.name || id).trim() || id
    const parentRaw = body.parentId
    const parentId =
      parentRaw === null || parentRaw === undefined || parentRaw === ''
        ? null
        : String(parentRaw)
    return {
      settingId: String(record.id),
      id,
      name,
      parentId: parentId === id ? null : parentId,
    }
  })

  return sanitizeReportFolderParents(folders).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

export async function saveReportFolder(
  folder: { id?: string; name: string; parentId?: string | null },
  settingId?: string | null,
): Promise<ReportFolder> {
  const name = folder.name.trim()
  if (!name) throw new Error('Folder name is required')
  const id = String(folder.id || `folder_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`)
  const folders = await listReportFolders()
  const parentId = normalizeFolderParentId(folder.parentId, id, folders)
  const body: ReportFolderBody = {
    id,
    name,
    parentId,
  }
  const savedId = await writeSettingUpsert({
    settingId: settingId ? String(settingId) : null,
    entityApiName: FOLDER_ENTITY_API_NAME,
    groupKey: SETTINGS_GROUP,
    subGroup: FOLDER_SUB_GROUP,
    name: normalizeReportName(name) || id,
    body: body as unknown as Record<string, unknown>,
  })
  return { settingId: String(savedId), id, name, parentId }
}

export async function deleteReportFolder(settingId: string): Promise<void> {
  const folders = await listReportFolders()
  const folder = folders.find((item) => item.settingId === settingId)
  if (!folder) {
    await writeSettingDelete(settingId)
    return
  }

  const reports = await listReports()
  const members = reports.filter((report) => report.config.folderId === folder.id)
  for (const report of members) {
    await saveReport(
      {
        ...report.config,
        folderId: null,
      },
      report.settingId,
      report.roleId,
    )
  }

  // Reparent children to the deleted folder's parent so the tree stays intact.
  const children = folders.filter((item) => item.parentId === folder.id)
  for (const child of children) {
    await saveReportFolder(
      {
        id: child.id,
        name: child.name,
        parentId: folder.parentId ?? null,
      },
      child.settingId,
    )
  }

  await writeSettingDelete(settingId)
}

/** Folder ids under `folderId` including itself. */
export function collectReportFolderDescendantIds(
  folders: ReportFolder[],
  folderId: string,
): Set<string> {
  const ids = new Set<string>([folderId])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (!folder.parentId || ids.has(folder.id) || !ids.has(folder.parentId)) continue
      ids.add(folder.id)
      changed = true
    }
  }
  return ids
}

/** Breadcrumb path label, e.g. "Sales / West". */
export function reportFolderPathLabel(
  folders: ReportFolder[],
  folderId: string | null | undefined,
  fallback = '',
): string {
  if (!folderId) return fallback
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const parts: string[] = []
  let current: ReportFolder | undefined = byId.get(folderId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parts.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return parts.join(' / ') || fallback || folderId
}

/** Depth of a folder (root = 1). */
export function reportFolderDepth(
  folders: ReportFolder[],
  folderId: string | null | undefined,
): number {
  if (!folderId) return 0
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  let depth = 0
  let current: ReportFolder | undefined = byId.get(folderId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    depth += 1
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return depth
}

function normalizeFolderParentId(
  parentId: string | null | undefined,
  folderId: string,
  folders: ReportFolder[],
): string | null {
  if (parentId === null || parentId === undefined || parentId === '') return null
  const parent = String(parentId)
  if (parent === folderId) {
    throw new Error('A folder cannot be its own parent.')
  }
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  if (!byId.has(parent)) {
    throw new Error('Parent folder was not found.')
  }

  // Reject cycles: parent chain must not include this folder.
  let cursor: ReportFolder | undefined = byId.get(parent)
  const seen = new Set<string>([folderId])
  while (cursor) {
    if (seen.has(cursor.id)) {
      throw new Error('Folder parent would create a cycle.')
    }
    seen.add(cursor.id)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }

  const parentDepth = reportFolderDepth(folders, parent)
  if (parentDepth >= REPORT_FOLDER_MAX_DEPTH) {
    throw new Error(`Folders can be nested up to ${REPORT_FOLDER_MAX_DEPTH} levels.`)
  }

  return parent
}

function sanitizeReportFolderParents(folders: ReportFolder[]): ReportFolder[] {
  const ids = new Set(folders.map((folder) => folder.id))
  return folders.map((folder) => {
    if (!folder.parentId || !ids.has(folder.parentId) || folder.parentId === folder.id) {
      return { ...folder, parentId: null }
    }
    return folder
  })
}

function parseFolderBody(body: ReportFolderBody | string | null | undefined): Partial<ReportFolderBody> {
  if (!body) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as Partial<ReportFolderBody>
    } catch {
      return {}
    }
  }
  return body
}

export async function listReportFields(
  collection: string,
): Promise<ReportFieldOption[]> {
  return (await listReportFieldTreeNodes(collection)).map((node) => node.data)
}

export async function loadReportFieldTreeMetadata(): Promise<ReportFieldTreeMetadata> {
  const [fieldsRaw, relationsRaw] = await Promise.all([
    getCachedFields(),
    getCachedRelations(),
  ])
  const fields = fieldsRaw as FieldDefinition[]
  const relations = relationsRaw as RelationDefinition[]
  const fieldsByCollection = fields.reduce<Map<string, FieldDefinition[]>>(
    (groups, field) => {
      const group = groups.get(field.collection) ?? []
      group.push(field)
      groups.set(field.collection, group)
      return groups
    },
    new Map(),
  )

  return { fieldsByCollection, relations }
}

export async function listReportFieldTreeNodes(
  collection: string,
  parentPath = '',
  parentLabel = '',
  metadata?: ReportFieldTreeMetadata,
): Promise<ReportFieldTreeNode[]> {
  if (!collection) return []
  const fieldMetadata = metadata ?? await loadReportFieldTreeMetadata()

  const targetCollection = parentPath
    ? resolveM2OFieldPathFromMetadata(collection, parentPath, fieldMetadata)?.relatedCollection
    : collection
  if (!targetCollection) return []

  const relatedFields = fieldMetadata.fieldsByCollection.get(targetCollection) ?? []
  const nodes = await Promise.all(
    relatedFields
      .filter((field) => isReportableField(field))
      .map(async (field) =>
        buildReportFieldTreeNode(
          field,
          fieldMetadata.relations,
          parentPath,
          parentLabel,
        ),
      ),
    )

  return nodes
    .filter((node): node is ReportFieldTreeNode => Boolean(node))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export async function saveReport(
  report: ReportDefinition,
  settingId?: string | number | null,
  roleId: string | null = null,
): Promise<ReportWithSetting> {
  const config = normalizeReportDefinition(report)
  const existing = settingId ? null : await readReportByName(config.name)
  const targetId = settingId ?? existing?.id

  const savedId = await writeSettingUpsert({
    settingId: targetId ? String(targetId) : null,
    entityApiName: config.collection,
    groupKey: SETTINGS_GROUP,
    subGroup: SETTINGS_SUB_GROUP,
    roleId,
    name: config.name,
    body: config as unknown as Record<string, unknown>,
  })

  return {
    settingId: savedId,
    name: config.name,
    title: config.title,
    collection: config.collection,
    roleId,
    config,
  }
}

export async function executeReport(
  report: ReportDefinition,
): Promise<Record<string, unknown>[]> {
  const config = normalizeReportDefinition(report)
  if (!config.collection) return []

  const request = await reportQueryRequest(config)
  const filter = buildReportFilter(config)
  const sort = tabularSortSpec(config)

  const rows = await bridgeReadItems(config.collection, {
    limit: config.limit ?? -1,
    fields: request.fields,
    ...(filter ? { filter } : {}),
    ...(sort ? { sort } : {}),
  })

  return renderReportRows(rows, request.m2o)
}

/** Conditions the end user may change on the runtime report page. */
export function listRuntimeVisibleFilters(
  report: ReportDefinition | null | undefined,
): ReportFilterCondition[] {
  if (!report) return []
  return normalizeReportDefinition(report).conditions.filter(
    (condition) => condition.visibleInRuntime,
  )
}

/**
 * Merge runtime prompt values into a report copy for execution.
 * Cleared visible filters are omitted (treated as “any”).
 * Hidden filters keep their saved values.
 */
export function applyRuntimeFilterValues(
  report: ReportDefinition,
  valuesByConditionId: Record<string, unknown>,
): ReportDefinition {
  const normalized = normalizeReportDefinition(report)
  return {
    ...normalized,
    conditions: normalized.conditions
      .map((condition) => {
        if (!condition.visibleInRuntime) return condition
        if (!(condition.id in valuesByConditionId)) return condition
        return {
          ...condition,
          value: valuesByConditionId[condition.id],
        }
      })
      .filter((condition) => {
        if (!condition.visibleInRuntime) return true
        if (condition.operator === '_null' || condition.operator === '_nnull') {
          return true
        }
        return !isEmptyRuntimeFilterValue(condition.value)
      }),
  }
}

function isEmptyRuntimeFilterValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  if (typeof value === 'number' && Number.isNaN(value)) return true
  if (Array.isArray(value)) {
    return value.every((entry) => isEmptyRuntimeFilterValue(entry))
  }
  return false
}

function tabularSortSpec(report: ReportDefinition): string[] | null {
  if (!isTabularReport(report)) return null
  const specs = report.tabular.columns
    .filter((column) => column.sort === 'asc' || column.sort === 'desc')
    .map((column) => (column.sort === 'desc' ? `-${column.field}` : column.field))
  return specs.length > 0 ? specs : null
}

/** Fill Month (etc.) on date/datetime dimensions that have no dateGrain yet. */
export async function resolveReportDateGrains(
  report: ReportDefinition,
): Promise<ReportDefinition> {
  const config = normalizeReportDefinition(report)
  const unresolved = [
    ...config.tabular.groupRows,
    ...config.tabular.groupColumns,
  ].filter((dimension) => dimension.field && !normalizePivotDateGrain(dimension.dateGrain))
  if (unresolved.length === 0 || !config.collection) return config

  const relations = await getCachedRelations()
  const grainByField = new Map<string, ReportDateGrain>()
  await Promise.all(
    unresolved.map(async (dimension) => {
      const field = await resolveFieldPath(config.collection, dimension.field, relations)
      if (!field) return
      const relation = findRelationForField(field, relations)
      const component = mapFieldTypeToComponent(field, relation)
      const dateGrain = defaultDateGrainForField(field.type, component ?? undefined)
      if (dateGrain) grainByField.set(dimension.field, dateGrain)
    }),
  )
  if (grainByField.size === 0) return config

  const patchGroups = (groups: ReportTabularGroup[]): ReportTabularGroup[] =>
    groups.map((group) => {
      if (normalizePivotDateGrain(group.dateGrain)) return group
      const dateGrain = grainByField.get(group.field)
      return dateGrain ? { ...group, dateGrain } : group
    })

  const tabular = {
    ...config.tabular,
    groupRows: patchGroups(config.tabular.groupRows),
    groupColumns: patchGroups(config.tabular.groupColumns),
  }
  const pivot = reportAsPivotSettings(tabular) ?? {
    rows: [],
    columns: [],
    values: [],
    sortRowsByTotal: tabular.sortRowsByTotal ?? null,
  }

  return {
    ...config,
    tabular,
    pivot,
  }
}

export async function defaultReportDefinition(
  collection = '',
  _type: ReportType | string = 'tabular',
): Promise<ReportDefinition> {
  const fields = collection ? await listFilterableFields(collection).catch(() => []) : []
  const firstField = fields[0]?.field ?? 'id'

  return normalizeReportDefinition({
    id: `report_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    name: '',
    title: '',
    collection,
    type: 'tabular',
    filterLogic: 'and',
    conditions: [],
    pivot: { rows: [], columns: [], values: [] },
    tabular: emptyTabularSettings(
      firstField ? [{ field: firstField, sort: 'asc' }] : [],
    ),
    limit: -1,
    folderId: null,
  })
}

export function emptyTabularSettings(
  columns: ReportTabularColumn[] = [],
): ReportTabularSettings {
  return {
    columns,
    groupRows: [],
    groupColumns: [],
    /** Off by default so Summarize shows one aggregated row per group (SF summary). */
    showDetailRows: false,
    showSubtotals: true,
    showGrandTotal: true,
    sortRowsByTotal: null,
  }
}

export function normalizeReportType(_value?: unknown): ReportType {
  return 'tabular'
}

export function normalizeSummaryAggregates(value: unknown): ReportSummaryAggregate[] {
  if (!Array.isArray(value)) return []
  const aggregates: ReportSummaryAggregate[] = []
  for (const item of value) {
    if (isReportSummaryAggregate(item) && !aggregates.includes(item)) {
      aggregates.push(item)
    }
  }
  return aggregates
}

export function normalizeTabularGroups(value: unknown): ReportTabularGroup[] {
  if (!Array.isArray(value)) return []
  const groups: ReportTabularGroup[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      groups.push({ field: item.trim(), sort: 'asc', dateGrain: null })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const field = String((item as ReportTabularGroup).field ?? '').trim()
    if (!field) continue
    groups.push({
      field,
      sort: normalizePivotSort((item as ReportTabularGroup).sort),
      dateGrain: normalizePivotDateGrain((item as ReportTabularGroup).dateGrain),
    })
  }
  return groups
}

export function normalizeTabularColumns(value: unknown): ReportTabularColumn[] {
  if (!Array.isArray(value)) return []
  const columns: ReportTabularColumn[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      columns.push({ field: item.trim(), sort: null, summaries: [] })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const field = String((item as ReportTabularColumn).field ?? '').trim()
    if (!field) continue
    const sortRaw = (item as ReportTabularColumn).sort
    columns.push({
      field,
      sort: sortRaw === 'asc' || sortRaw === 'desc' ? sortRaw : null,
      summaries: normalizeSummaryAggregates((item as ReportTabularColumn).summaries),
    })
  }
  return columns
}

export function normalizeTabularSettings(
  value: Partial<ReportTabularSettings> | null | undefined,
): ReportTabularSettings {
  return {
    columns: normalizeTabularColumns(value?.columns),
    groupRows: normalizeTabularGroups(value?.groupRows),
    groupColumns: normalizeTabularGroups(value?.groupColumns),
    showDetailRows: value?.showDetailRows === true,
    showSubtotals: value?.showSubtotals !== false,
    showGrandTotal: value?.showGrandTotal !== false,
    sortRowsByTotal: normalizeSortRowsByTotal(value?.sortRowsByTotal),
  }
}

export function isReportSummaryAggregate(value: unknown): value is ReportSummaryAggregate {
  return ['count', 'sum', 'avg', 'min', 'max', 'median'].includes(String(value))
}

function summaryToPivotAggregate(
  summary: ReportSummaryAggregate,
): ReportAggregate | null {
  if (summary === 'median') return null
  if (summary === 'count') return 'count'
  if (summary === 'sum' || summary === 'avg' || summary === 'min' || summary === 'max') {
    return summary
  }
  return null
}

function tabularSummaryValues(tabular: ReportTabularSettings): ReportPivotValue[] {
  const values: ReportPivotValue[] = []
  for (const column of tabular.columns) {
    const summaries = column.summaries?.length
      ? column.summaries
      : (['sum'] as ReportSummaryAggregate[])
    for (const summary of summaries) {
      const aggregate = summaryToPivotAggregate(summary)
      if (!aggregate) continue
      values.push({ field: column.field, aggregate })
    }
  }
  if (values.length === 0 && tabular.columns[0]) {
    values.push({ field: tabular.columns[0].field, aggregate: 'count' })
  }
  return values
}

/** When group columns are set, tabular preview can reuse the pivot matrix renderer. */
export function tabularAsPivotSettings(
  tabular: ReportTabularSettings,
): ReportPivotSettings | null {
  if (tabular.groupColumns.length === 0) return null
  const values = tabularSummaryValues(tabular)
  if (values.length === 0) return null
  return {
    rows: tabular.groupRows.map((group) => ({
      field: group.field,
      sort: group.sort ?? 'asc',
      dateGrain: group.dateGrain ?? null,
    })),
    columns: tabular.groupColumns.map((group) => ({
      field: group.field,
      sort: group.sort ?? 'asc',
      dateGrain: group.dateGrain ?? null,
    })),
    values,
    sortRowsByTotal: tabular.sortRowsByTotal ?? null,
  }
}

/**
 * Pivot settings for matrix OR row-grouped summary (dashboards / export).
 * Returns null when there is nothing to aggregate.
 */
export function reportAsPivotSettings(
  tabular: ReportTabularSettings,
): ReportPivotSettings | null {
  const matrix = tabularAsPivotSettings(tabular)
  if (matrix) return matrix
  const values = tabularSummaryValues(tabular)
  if (values.length === 0) return null
  if (tabular.groupRows.length === 0 && tabular.showDetailRows === true) return null
  return {
    rows: tabular.groupRows.map((group) => ({
      field: group.field,
      sort: group.sort ?? 'asc',
      dateGrain: group.dateGrain ?? null,
    })),
    columns: [],
    values,
    sortRowsByTotal: tabular.sortRowsByTotal ?? null,
  }
}

/** Convert legacy pivot config into tabular when tabular outline is empty. */
export function migratePivotIntoTabular(
  pivot: ReportPivotSettings,
  tabular: ReportTabularSettings,
): ReportTabularSettings {
  const hasTabularStructure =
    tabular.columns.length > 0 ||
    tabular.groupRows.length > 0 ||
    tabular.groupColumns.length > 0
  if (hasTabularStructure) {
    if (tabular.sortRowsByTotal == null && pivot.sortRowsByTotal) {
      return { ...tabular, sortRowsByTotal: pivot.sortRowsByTotal }
    }
    return tabular
  }
  if (pivot.values.length === 0 && pivot.rows.length === 0 && pivot.columns.length === 0) {
    return tabular
  }

  return {
    columns: pivot.values.map((value) => ({
      field: value.field === '*' ? 'id' : value.field,
      sort: null as ReportSortDirection | null,
      summaries: [
        value.aggregate === 'count'
          ? ('count' as ReportSummaryAggregate)
          : (value.aggregate as ReportSummaryAggregate),
      ],
    })),
    groupRows: pivot.rows.map((dimension) => ({
      field: dimension.field,
      sort: dimension.sort ?? 'asc',
      dateGrain: dimension.dateGrain ?? null,
    })),
    groupColumns: pivot.columns.map((dimension) => ({
      field: dimension.field,
      sort: dimension.sort ?? 'asc',
      dateGrain: dimension.dateGrain ?? null,
    })),
    showDetailRows: false,
    showSubtotals: false,
    showGrandTotal: true,
    sortRowsByTotal: pivot.sortRowsByTotal ?? null,
  }
}

export function normalizeReportDefinition(
  report: Partial<ReportDefinition> | null | undefined,
  fallback: Partial<ReportDefinition> = {},
): ReportDefinition {
  const collection = String(report?.collection || fallback.collection || '')
  const titleCandidate = String(report?.title || fallback.title || '')
  const name = normalizeReportName(report?.name || fallback.name || titleCandidate)
  const title = titleCandidate || name || 'Untitled report'
  const conditions = Array.isArray(report?.conditions)
    ? report.conditions
        .filter((condition) => condition?.field && condition?.operator)
        .map((condition) => ({
          id: condition.id || `rpt_condition_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
          field: condition.field,
          operator: condition.operator,
          value: condition.value,
          visibleInRuntime: Boolean(condition.visibleInRuntime),
        }))
    : []
  const pivotRaw = (report?.pivot ?? fallback.pivot ?? {}) as Partial<ReportPivotSettings>
  const pivotValues = Array.isArray(pivotRaw.values)
    ? pivotRaw.values
        .filter((value) => value?.field && isReportAggregate(value.aggregate))
        .map((value) => ({
          field: value.field,
          aggregate: value.aggregate,
        }))
    : []
  const legacyPivot: ReportPivotSettings = {
    rows: normalizePivotDimensions(pivotRaw.rows),
    columns: normalizePivotDimensions(pivotRaw.columns),
    values: pivotValues,
    sortRowsByTotal: normalizeSortRowsByTotal(pivotRaw.sortRowsByTotal),
  }
  const tabular = migratePivotIntoTabular(
    legacyPivot,
    normalizeTabularSettings(
      (report?.tabular ?? fallback.tabular ?? {}) as Partial<ReportTabularSettings>,
    ),
  )
  // Keep pivot mirror in sync for leftover consumers.
  const pivot = reportAsPivotSettings(tabular) ?? {
    rows: [],
    columns: [],
    values: [],
    sortRowsByTotal: tabular.sortRowsByTotal ?? null,
  }

  const folderIdRaw = report?.folderId ?? fallback.folderId
  const folderId =
    folderIdRaw === null || folderIdRaw === undefined || folderIdRaw === ''
      ? null
      : String(folderIdRaw)

  return {
    id: String(report?.id || fallback.id || `report_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`),
    name,
    title,
    collection,
    type: 'tabular',
    filterLogic: report?.filterLogic === 'or' ? 'or' : 'and',
    conditions,
    pivot,
    tabular,
    limit: normalizeLimit(report?.limit),
    folderId,
    columnWidths: normalizeColumnWidths(report?.columnWidths ?? fallback.columnWidths),
  }
}

/** Last path segment for report headers (`opportunity.account_id.type` → `type`). */
export function reportFieldLeafName(field: string): string {
  const parts = String(field || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts[parts.length - 1] || String(field || '')
}

/** Humanized leaf label for report column/row headers. */
export function reportFieldDisplayLabel(field: string): string {
  const leaf = reportFieldLeafName(field)
  if (!leaf || leaf === '*') return leaf || field
  return leaf
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim()
}

export function reportColumnWidthKey(
  kind: 'row' | 'col' | 'value' | 'field',
  field: string,
  aggregate?: string,
): string {
  if (kind === 'value') {
    return `value:${aggregate || 'sum'}:${field}`
  }
  if (kind === 'field') return `field:${field}`
  return `${kind}:${field}`
}

function normalizeColumnWidths(
  value: unknown,
): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const next: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const width = typeof raw === 'number' ? raw : Number(raw)
    if (!key.trim() || !Number.isFinite(width) || width < 40) continue
    next[key] = Math.round(width)
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export function pivotDimensionFields(
  dimensions: ReportPivotDimension[] | undefined | null,
): string[] {
  return (dimensions ?? [])
    .map((dimension) => dimension.field)
    .filter((field) => Boolean(field?.trim()))
}

export function normalizePivotSort(value: unknown): ReportSortDirection {
  return value === 'desc' ? 'desc' : 'asc'
}

export function normalizeSortRowsByTotal(value: unknown): ReportSortDirection | null {
  return value === 'asc' || value === 'desc' ? value : null
}

export function normalizePivotDimensions(value: unknown): ReportPivotDimension[] {
  if (!Array.isArray(value)) return []

  const dimensions: ReportPivotDimension[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      dimensions.push({ field: item.trim(), sort: 'asc', dateGrain: null })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const field = String((item as ReportPivotDimension).field ?? '').trim()
    if (!field) continue
    dimensions.push({
      field,
      sort: normalizePivotSort((item as ReportPivotDimension).sort),
      dateGrain: normalizePivotDateGrain((item as ReportPivotDimension).dateGrain),
    })
  }
  return dimensions
}

export function buildReportFilter(
  report: ReportDefinition,
): Record<string, unknown> | null {
  const conditions = report.conditions
    .filter((condition) => condition.field && condition.operator)
    .map((condition) =>
      buildFieldFilter(
        condition.field,
        condition.operator,
        normalizeConditionValue(condition),
        condition,
      ),
    )
    .filter((filter): filter is Record<string, unknown> => filter != null)

  if (conditions.length === 0) return null
  if (conditions.length === 1) return conditions[0]

  return {
    [report.filterLogic === 'or' ? '_or' : '_and']: conditions,
  }
}

/** Leaf collection + field name for nested paths (e.g. opportunity.account_id.type). */
export async function resolveReportFieldLeafContext(
  rootCollection: string,
  fieldPath: string,
): Promise<{ collection: string; field: string } | null> {
  const parts = fieldPath.split('.').filter(Boolean)
  if (!rootCollection || parts.length === 0) return null

  const relations = (await getCachedRelations()) as RelationDefinition[]
  let currentCollection = rootCollection

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (index === parts.length - 1) {
      return { collection: currentCollection, field: part }
    }

    const fields = (await getCachedCollectionFields(currentCollection)) as FieldDefinition[]
    const field = fields.find((item) => item.field === part)
    const relation = relations.find(
      (item) => item.collection === currentCollection && item.field === part,
    )
    if (!isM2ORelation(field, relation) || !relation?.related_collection) {
      return null
    }
    currentCollection = relation.related_collection
  }

  return null
}

export function normalizeReportName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function readReportByName(name: string): Promise<ReportSettingRecord | null> {
  return readSettingRecord<ReportSettingRecord>({
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
    name,
    limit: 1,
  })
}

function parseReportBody(record: ReportSettingRecord): Partial<ReportDefinition> {
  if (!record.body) return {}
  return typeof record.body === 'string'
    ? JSON.parse(record.body) as Partial<ReportDefinition>
    : record.body
}

async function reportQueryRequest(report: ReportDefinition): Promise<ReportQueryRequest> {
  const fields = new Set([
    'id',
    ...pivotDimensionFields(report.pivot.rows),
    ...pivotDimensionFields(report.pivot.columns),
    ...report.pivot.values.map((value) => value.field),
    ...report.tabular.columns.map((column) => column.field),
    ...report.tabular.groupRows.map((group) => group.field),
    ...report.tabular.groupColumns.map((group) => group.field),
    ...report.conditions.map((condition) => condition.field),
  ].filter(Boolean))

  if (report.collection) {
    const displayTemplate = await fetchCollectionDisplayTemplate(report.collection).catch(() => undefined)
    if (displayTemplate) {
      for (const field of extractTemplateFields(displayTemplate)) {
        fields.add(field)
      }
    }
  }

  if (fields.size <= 1 && report.collection) {
    const metadata = await listFilterableFields(report.collection).catch(() => [])
    for (const field of metadata.slice(0, 8)) {
      fields.add(field.field)
    }
  }

  const fieldNames = Array.from(fields).filter((field) => field !== '*')
  const m2o = await reportM2OMetadata(report.collection, fieldNames)
  return {
    fields: reportRequestFields(fieldNames, m2o),
    m2o,
  }
}

function reportRequestFields(
  fieldNames: string[],
  m2o: ReportM2OMetadata,
): string[] {
  const requestFields = new Set<string>()

  for (const fieldName of fieldNames) {
    const relatedCollection = m2o.collections.get(fieldName)
    if (!relatedCollection) {
      requestFields.add(fieldName)
      continue
    }

    requestFields.add(`${fieldName}.id`)
    const template = m2o.templates.get(fieldName)
    if (template) {
      for (const templateField of extractTemplateFields(template)) {
        requestFields.add(`${fieldName}.${templateField}`)
      }
      continue
    }

    requestFields.add(`${fieldName}.${m2o.displayFields.get(fieldName) ?? 'id'}`)
  }

  return Array.from(requestFields)
}

async function reportM2OMetadata(
  collection: string,
  fieldNames: string[],
): Promise<ReportM2OMetadata> {
  const relationsRaw = await getCachedRelations()
  const relations = relationsRaw as RelationDefinition[]
  const collections = new Map<string, string>()
  const displayFields = new Map<string, string>()
  const templates = new Map<string, string>()
  const choiceLabels = new Map<string, Map<string, string>>()
  const relatedFieldsByCollection = new Map<string, FieldDefinition[]>()

  for (const fieldName of fieldNames) {
    const resolved = await resolveM2OFieldPath(collection, fieldName, relations)
    if (resolved) {
      collections.set(fieldName, resolved.relatedCollection)
      relatedFieldsByCollection.set(resolved.relatedCollection, resolved.relatedFields)
      continue
    }

    const choiceLabelMap = await resolveChoiceLabelsForPath(collection, fieldName, relations)
    if (choiceLabelMap.size > 0) {
      choiceLabels.set(fieldName, choiceLabelMap)
    }
  }

  // Authoritative label source: related entity Display Template (Setup → Entity parameters).
  const templatesByCollection = new Map<string, string>()
  await Promise.all(
    [...new Set(collections.values())].map(async (relatedCollection) => {
      const template = await fetchCollectionDisplayTemplate(relatedCollection).catch(() => undefined)
      if (!template?.trim()) return
      const templateFields = extractTemplateFields(template)
      if (shouldUseTemplateForRelatedLabel(template, templateFields)) {
        templatesByCollection.set(relatedCollection, template)
      }
    }),
  )

  for (const [fieldName, relatedCollection] of collections) {
    const template = templatesByCollection.get(relatedCollection)
    if (template) {
      templates.set(fieldName, template)
      continue
    }
    const relatedFields =
      relatedFieldsByCollection.get(relatedCollection) ??
      ((await getCachedCollectionFields(relatedCollection).catch(() => [])) as FieldDefinition[])
    displayFields.set(fieldName, relatedRecordDisplayField(relatedFields))
  }

  return { collections, displayFields, templates, choiceLabels }
}

function renderReportRows(
  rows: Record<string, unknown>[],
  m2o: ReportM2OMetadata,
): Record<string, unknown>[] {
  return rows.map((row) => {
    const rendered = { ...row }

    for (const [field, relatedCollection] of m2o.collections) {
      const value = getPathValue(row, field)
      const record = value && typeof value === 'object'
        ? value as Record<string, unknown>
        : null
      const id = record?.id ?? value
      const template = m2o.templates.get(field)
      const templateFields = template ? extractTemplateFields(template) : []
      let label = ''
      if (record && template && shouldUseTemplateForRelatedLabel(template, templateFields)) {
        label = renderTemplateLabel(template, record).trim()
      }
      if (!label || label === String(id ?? '')) {
        label = relatedRecordFallbackLabel(record ?? value, id)
      }

      setPathValue(rendered, field, {
        ...(record ?? {}),
        __crmValueType: 'm2o',
        id,
        label,
        relatedCollection,
      })
    }

    for (const [field, labels] of m2o.choiceLabels) {
      const value = getPathValue(rendered, field)
      const label = choiceValueLabel(value, labels)
      if (label !== undefined) {
        setPathValue(rendered, field, label)
      }
    }

    return rendered
  })
}

async function buildReportFieldTreeNode(
  field: FieldDefinition,
  relations: RelationDefinition[],
  parentPath: string,
  parentLabel: string,
): Promise<ReportFieldTreeNode | null> {
  const relation = findRelationForField(field, relations)
  const component = mapFieldTypeToComponent(field, relation)
  if (!component) return null

  const fallbackLabel =
    field.meta?.note?.trim() ||
    humanizeFieldName(field.field)
  const nodeLabel = await translatedFieldLabel(field, fallbackLabel)
  const path = parentPath ? `${parentPath}.${field.field}` : field.field
  const label = parentLabel ? `${parentLabel} > ${nodeLabel}` : nodeLabel
  const option: ReportFieldOption = {
    field: path,
    label,
    type: field.type,
    component: component as PrimeVueComponentType,
  }

  if (parentPath) {
    option.sourceField = parentPath.split('.')[0]
    option.nestedField = field.field
  }

  if (component === 'AutoComplete' && relation?.related_collection) {
    option.relatedCollection = relation.related_collection
  }

  const canExpand = Boolean(option.relatedCollection)
  return {
    key: path,
    label: nodeLabel,
    leaf: !canExpand,
    selectable: true,
    data: option,
    ...(canExpand ? { children: [] } : {}),
  }
}

async function resolveChoiceLabelsForPath(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): Promise<Map<string, string>> {
  const field = await resolveFieldPath(collection, fieldName, relations)
  return buildChoiceLabelMap(field?.meta?.options?.choices)
}

async function resolveM2OFieldPath(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): Promise<ResolvedM2OField | null> {
  const parts = fieldName.split('.').filter(Boolean)
  if (parts.length === 0) return null

  let currentCollection = collection
  let field: FieldDefinition | undefined
  let relation: RelationDefinition | undefined

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const fields = await getCachedCollectionFields(currentCollection) as FieldDefinition[]
    field = fields.find((item) => item.field === part)
    relation = relations.find(
      (item) => item.collection === currentCollection && item.field === part,
    )

    const relatedCollection = relation?.related_collection
    const isM2O = isM2ORelation(field, relation)
    if (!isM2O || !relatedCollection) return null

    if (index === parts.length - 1) {
      const relatedFields = await getCachedCollectionFields(relatedCollection) as FieldDefinition[]
      return {
        field,
        relatedCollection,
        relatedFields,
      }
    }

    currentCollection = relatedCollection
  }

  return null
}

function resolveM2OFieldPathFromMetadata(
  collection: string,
  fieldName: string,
  metadata: ReportFieldTreeMetadata,
): ResolvedM2OField | null {
  const parts = fieldName.split('.').filter(Boolean)
  if (parts.length === 0) return null

  let currentCollection = collection
  let field: FieldDefinition | undefined
  let relation: RelationDefinition | undefined

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const fields = metadata.fieldsByCollection.get(currentCollection) ?? []
    field = fields.find((item) => item.field === part)
    relation = metadata.relations.find(
      (item) => item.collection === currentCollection && item.field === part,
    )

    const relatedCollection = relation?.related_collection
    const isM2O = isM2ORelation(field, relation)
    if (!isM2O || !relatedCollection) return null

    if (index === parts.length - 1) {
      return {
        field,
        relatedCollection,
        relatedFields: metadata.fieldsByCollection.get(relatedCollection) ?? [],
      }
    }

    currentCollection = relatedCollection
  }

  return null
}

async function resolveFieldPath(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): Promise<FieldDefinition | undefined> {
  const parts = fieldName.split('.').filter(Boolean)
  if (parts.length === 0) return undefined

  let currentCollection = collection
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    const fields = await getCachedCollectionFields(currentCollection) as FieldDefinition[]
    const field = fields.find((item) => item.field === part)
    if (!field) return undefined
    if (index === parts.length - 1) return field

    const relation = relations.find(
      (item) => item.collection === currentCollection && item.field === part,
    )
    if (!isM2ORelation(field, relation) || !relation?.related_collection) {
      return undefined
    }
    currentCollection = relation.related_collection
  }

  return undefined
}

function isM2ORelation(
  field: FieldDefinition | undefined,
  relation: RelationDefinition | undefined,
): boolean {
  const special = normalizeSpecial(field?.meta?.special)
  return Boolean(relation?.related_collection) && (
    special.includes('m2o') || Boolean(relation?.related_collection)
  )
}

function normalizeConditionValue(condition: ReportFilterCondition): unknown {
  if (condition.operator === '_null' || condition.operator === '_nnull') return true
  if (condition.operator === '_between') {
    return normalizeBetweenBounds(condition.value)
  }
  return normalizeScalarFilterValue(condition.value)
}

function normalizeScalarFilterValue(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return value ?? null
  // Select may emit `{ label, value }` when optionValue is missing — use the scalar.
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    const record = value as Record<string, unknown>
    if ('value' in record && !('from' in record) && !('start' in record)) {
      return normalizeScalarFilterValue(record.value)
    }
  }
  const date = toDate(value)
  if (date) return formatLocalDate(date)
  return value
}

function normalizeBetweenBounds(value: unknown): [unknown, unknown] | null {
  const pair = coerceBetweenPair(value)
  if (!pair) return null
  const from = normalizeScalarFilterValue(pair[0])
  const to = normalizeScalarFilterValue(pair[1])
  if (
    (from === null || from === undefined || from === '') &&
    (to === null || to === undefined || to === '')
  ) {
    return null
  }
  return [from ?? null, to ?? null]
}

function coerceBetweenPair(value: unknown): [unknown, unknown] | null {
  if (Array.isArray(value) && value.length >= 2) {
    return [value[0], value[1]]
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if ('from' in record || 'to' in record) {
      return [record.from ?? null, record.to ?? null]
    }
    if ('start' in record || 'end' in record) {
      return [record.start ?? null, record.end ?? null]
    }
  }
  return null
}

function buildFieldFilter(
  field: string,
  operator: string,
  value: unknown,
  condition?: ReportFilterCondition,
): Record<string, unknown> | null {
  if (operator === '_between') {
    const bounds = Array.isArray(value)
      ? (value as [unknown, unknown])
      : normalizeBetweenBounds(condition?.value)
    if (!bounds) return null
    const [from, to] = bounds
    const parts: Record<string, unknown>[] = []
    if (from !== null && from !== undefined && from !== '') {
      parts.push(nestFieldFilter(field, { _gte: from }))
    }
    if (to !== null && to !== undefined && to !== '') {
      parts.push(nestFieldFilter(field, { _lte: to }))
    }
    if (parts.length === 0) return null
    if (parts.length === 1) return parts[0]
    return { _and: parts }
  }

  return nestFieldFilter(field, { [operator]: value })
}

function nestFieldFilter(
  field: string,
  leaf: Record<string, unknown>,
): Record<string, unknown> {
  const parts = field.split('.').filter(Boolean)
  return parts
    .slice()
    .reverse()
    .reduce<Record<string, unknown>>(
      (filter, part) => ({ [part]: filter }),
      leaf,
    )
}

function normalizeLimit(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return -1
}

function isReportAggregate(value: unknown): value is ReportAggregate {
  return ['count', 'sum', 'avg', 'min', 'max'].includes(String(value))
}

function isReportableField(field: FieldDefinition): boolean {
  if (field.meta?.hidden) return false
  if (field.type === 'alias') return false
  if (['user_updated', 'date_updated'].includes(field.field)) return false
  return true
}
