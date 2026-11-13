import { currentUserRole } from '@/core/currentUser'
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
export type ReportSummaryAggregate = 'sum' | 'avg' | 'min' | 'max' | 'median'
export type ReportSortDirection = 'asc' | 'desc'
export type ReportType = 'pivot' | 'tabular'
export type { ReportDateGrain }

export interface ReportFilterCondition {
  id: string
  field: string
  operator: string
  value: unknown
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
}

export interface ReportTabularColumn {
  field: string
  sort?: ReportSortDirection | null
  /** Numeric column summaries (SF-style Summarize). */
  summaries?: ReportSummaryAggregate[]
}

export interface ReportTabularSettings {
  columns: ReportTabularColumn[]
  groupRows: ReportTabularGroup[]
  groupColumns: ReportTabularGroup[]
  showDetailRows?: boolean
  showSubtotals?: boolean
  showGrandTotal?: boolean
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
  /** pivot = matrix aggregates; tabular = flat column list (SF-style tabular). */
  type: ReportType
  filterLogic: FilterLogic
  conditions: ReportFilterCondition[]
  pivot: ReportPivotSettings
  tabular: ReportTabularSettings
  limit?: number
  /** Flat folder id from report folder settings; null = unfiled. */
  folderId?: string | null
}

export interface ReportFolder {
  settingId: string
  id: string
  name: string
}

interface ReportFolderBody {
  id: string
  name: string
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

export function isReportVisibleToRole(
  report: Pick<ReportWithSetting, 'roleId'>,
  roleId: string | null,
): boolean {
  if (report.roleId == null || report.roleId === '') return true
  if (roleId == null || roleId === '') return false
  return String(report.roleId) === String(roleId)
}

export function isPivotReport(report: Pick<ReportDefinition, 'type'>): boolean {
  return normalizeReportType(report.type) === 'pivot'
}

export function isTabularReport(report: Pick<ReportDefinition, 'type'>): boolean {
  return normalizeReportType(report.type) === 'tabular'
}

export function reportCanRun(report: ReportDefinition | null | undefined): boolean {
  if (!report?.collection) return false
  if (isTabularReport(report)) return report.tabular.columns.length > 0
  return report.pivot.values.length > 0
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

  return records
    .map((record) => {
      const body = parseFolderBody(
        record.body as ReportFolderBody | string | null | undefined,
      )
      const id = String(body.id || record.id)
      const name = String(body.name || record.name || id).trim() || id
      return {
        settingId: String(record.id),
        id,
        name,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveReportFolder(
  folder: { id?: string; name: string },
  settingId?: string | null,
): Promise<ReportFolder> {
  const name = folder.name.trim()
  if (!name) throw new Error('Folder name is required')
  const id = String(folder.id || `folder_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`)
  const body: ReportFolderBody = { id, name }
  const savedId = await writeSettingUpsert({
    settingId: settingId ? String(settingId) : null,
    entityApiName: FOLDER_ENTITY_API_NAME,
    groupKey: SETTINGS_GROUP,
    subGroup: FOLDER_SUB_GROUP,
    name: normalizeReportName(name) || id,
    body: body as unknown as Record<string, unknown>,
  })
  return { settingId: String(savedId), id, name }
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
  await writeSettingDelete(settingId)
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
  const unresolved = [...config.pivot.rows, ...config.pivot.columns].filter(
    (dimension) => dimension.field && !normalizePivotDateGrain(dimension.dateGrain),
  )
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

  const patch = (dimensions: ReportPivotDimension[]): ReportPivotDimension[] =>
    dimensions.map((dimension) => {
      if (normalizePivotDateGrain(dimension.dateGrain)) return dimension
      const dateGrain = grainByField.get(dimension.field)
      return dateGrain ? { ...dimension, dateGrain } : dimension
    })

  return {
    ...config,
    pivot: {
      ...config.pivot,
      rows: patch(config.pivot.rows),
      columns: patch(config.pivot.columns),
    },
  }
}

export async function defaultReportDefinition(
  collection = '',
  type: ReportType = 'pivot',
): Promise<ReportDefinition> {
  const fields = collection ? await listFilterableFields(collection).catch(() => []) : []
  const firstField = fields[0]?.field ?? 'id'
  const reportType = normalizeReportType(type)

  if (reportType === 'tabular') {
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

  return normalizeReportDefinition({
    id: `report_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    name: '',
    title: '',
    collection,
    type: 'pivot',
    filterLogic: 'and',
    conditions: [],
    pivot: {
      rows: firstField ? [{ field: firstField, sort: 'asc' }] : [],
      columns: [],
      values: [{ field: firstField, aggregate: 'count' }],
    },
    tabular: emptyTabularSettings(),
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
  }
}

export function normalizeReportType(value: unknown): ReportType {
  return value === 'tabular' ? 'tabular' : 'pivot'
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
      groups.push({ field: item.trim(), sort: 'asc' })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const field = String((item as ReportTabularGroup).field ?? '').trim()
    if (!field) continue
    groups.push({
      field,
      sort: normalizePivotSort((item as ReportTabularGroup).sort),
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
  }
}

export function isReportSummaryAggregate(value: unknown): value is ReportSummaryAggregate {
  return ['sum', 'avg', 'min', 'max', 'median'].includes(String(value))
}

/** When group columns are set, tabular preview can reuse the pivot matrix renderer. */
export function tabularAsPivotSettings(
  tabular: ReportTabularSettings,
): ReportPivotSettings | null {
  if (tabular.groupColumns.length === 0) return null
  const values: ReportPivotValue[] = []
  for (const column of tabular.columns) {
    const summaries = column.summaries?.length
      ? column.summaries
      : (['sum'] as ReportSummaryAggregate[])
    for (const summary of summaries) {
      if (summary === 'median') continue
      values.push({ field: column.field, aggregate: summary })
    }
  }
  if (values.length === 0) {
    values.push({ field: tabular.columns[0]?.field || 'id', aggregate: 'count' })
  }
  return {
    rows: tabular.groupRows.map((group) => ({
      field: group.field,
      sort: group.sort ?? 'asc',
    })),
    columns: tabular.groupColumns.map((group) => ({
      field: group.field,
      sort: group.sort ?? 'asc',
    })),
    values,
    sortRowsByTotal: null,
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
  const type = normalizeReportType(report?.type ?? fallback.type)
  const conditions = Array.isArray(report?.conditions)
    ? report.conditions
        .filter((condition) => condition?.field && condition?.operator)
        .map((condition) => ({
          id: condition.id || `rpt_condition_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
          field: condition.field,
          operator: condition.operator,
          value: condition.value,
        }))
    : []
  const pivot = (report?.pivot ?? {}) as Partial<ReportPivotSettings>
  const values = Array.isArray(pivot.values)
    ? pivot.values
        .filter((value) => value?.field && isReportAggregate(value.aggregate))
        .map((value) => ({
          field: value.field,
          aggregate: value.aggregate,
        }))
    : []
  const tabular = (report?.tabular ?? fallback.tabular ?? {}) as Partial<ReportTabularSettings>

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
    type,
    filterLogic: report?.filterLogic === 'or' ? 'or' : 'and',
    conditions,
    pivot: {
      rows: normalizePivotDimensions(pivot.rows),
      columns: normalizePivotDimensions(pivot.columns),
      values,
      sortRowsByTotal: normalizeSortRowsByTotal(pivot.sortRowsByTotal),
    },
    tabular: normalizeTabularSettings(tabular),
    limit: normalizeLimit(report?.limit),
    folderId,
  }
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

  for (const fieldName of fieldNames) {
    const resolved = await resolveM2OFieldPath(collection, fieldName, relations)
    if (resolved) {
      collections.set(fieldName, resolved.relatedCollection)
      const template =
        typeof resolved.field?.meta?.options?.template === 'string' &&
        resolved.field.meta.options.template.trim()
          ? resolved.field.meta.options.template
          : undefined
      const templateFields = template ? extractTemplateFields(template) : []
      if (shouldUseTemplateForRelatedLabel(template, templateFields) && template) {
        templates.set(fieldName, template)
      } else {
        displayFields.set(fieldName, relatedRecordDisplayField(resolved.relatedFields))
      }
      continue
    }

    const choiceLabelMap = await resolveChoiceLabelsForPath(collection, fieldName, relations)
    if (choiceLabelMap.size > 0) {
      choiceLabels.set(fieldName, choiceLabelMap)
    }
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
      const label =
        record && template
          ? renderTemplateLabel(template, record)
          : relatedRecordFallbackLabel(record ?? value, id)

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
