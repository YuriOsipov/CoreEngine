import type {
  DataTableColumnConfig,
  DataTableGroupConfig,
  DataTableSettings,
  DataTableSortConfig,
  ListViewAction,
  PrimeVueComponentType,
} from '@/interfaces'
import type {
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import {
  readSettingRecord,
  writeSettingUpsert,
} from '@/core/graphql/settingRecordsBridge'
import { getCachedCollectionFields, getCachedRelations } from './collectionSchema'
import {
  findRelationForField,
  mapFieldTypeToComponent,
} from '../utils/fieldMapper'
import { translateField } from '@/core/translation'
import { normalizeBarcodeScanSettings } from '@/core/barcodeScan'

const SETTINGS_GROUP = 'list'
const SETTINGS_SUB_GROUP = 'related_table'

interface TableSettingRecord {
  id: number | string
  collection: string
  group: string
  name?: string
  sub_group: string
  body?: DataTableSettings | string | null
}

export async function listDataTableFields(
  collection: string,
): Promise<DataTableColumnConfig[]> {
  const [fieldsRaw, relationsRaw] = await Promise.all([
    getCachedCollectionFields(collection),
    getCachedRelations(),
  ])
  const fields = fieldsRaw as unknown as FieldDefinition[]
  const relations = relationsRaw as unknown as RelationDefinition[]

  const columns = await Promise.all(fields
    .map((field) => {
      const relation = findRelationForField(field, relations)
      const component = mapFieldTypeToComponent(field, relation)
      return { field, relation, component }
    })
    .filter(({ field, component }) => {
      if (field.meta?.hidden) return false
      // Live rollups use ALIAS storage but are listable once mapped to a component.
      if (field.type === 'alias' && !component) return false
      if (['user_updated', 'date_updated'].includes(field.field)) return false
      if (!component) return false
      return true
    })
    .map(async ({ field, relation, component }) => ({
      field: field.field,
      header: await translateField(
        field,
        field.meta?.note?.trim() || humanizeFieldName(field.field),
      ),
      component: component as PrimeVueComponentType,
      relatedCollection:
        component === 'AutoComplete' && relation?.related_collection
          ? relation.related_collection
          : undefined,
      enabled: true,
    })))

  return columns
}

export async function buildDefaultTableSettings(
  collection: string,
  limit = 12,
): Promise<DataTableSettings> {
  const columns = await listDataTableFields(collection)

  return {
    columns: columns.slice(0, limit),
    sort: null,
  }
}

export async function loadTableSettings(
  collection: string,
): Promise<DataTableSettings | null> {
  const record = await readTableSettingRecord(collection)
  if (!record?.body) return null

  const body =
    typeof record.body === 'string'
      ? (JSON.parse(record.body) as DataTableSettings)
      : record.body

  return normalizeTableSettings(body)
}

export async function saveTableSettings(
  collection: string,
  settings: DataTableSettings,
): Promise<void> {
  const body = normalizeTableSettings(settings)
  const existing = await readTableSettingRecord(collection)

  await writeSettingUpsert({
    settingId: existing ? String(existing.id) : null,
    entityApiName: collection,
    groupKey: SETTINGS_GROUP,
    subGroup: SETTINGS_SUB_GROUP,
    name: collection,
    body: body as unknown as Record<string, unknown>,
  })
}

export const DEFAULT_RELATED_ROW_LIMIT = 5
const MIN_RELATED_ROW_LIMIT = 1
const MAX_RELATED_ROW_LIMIT = 100

function clampRelatedRowLimit(value: number): number {
  return Math.min(MAX_RELATED_ROW_LIMIT, Math.max(MIN_RELATED_ROW_LIMIT, Math.round(value)))
}

function parseRelatedRowLimit(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return clampRelatedRowLimit(parsed)
}

export function resolveRelatedRowLimit(
  settings?: DataTableSettings | null,
): number {
  return parseRelatedRowLimit(settings?.rowLimit) ?? DEFAULT_RELATED_ROW_LIMIT
}

export function resolveConfiguredRowLimit(rowLimit: unknown): number {
  return parseRelatedRowLimit(rowLimit) ?? DEFAULT_RELATED_ROW_LIMIT
}

export function normalizeTableSettings(
  settings: DataTableSettings | null | undefined,
): DataTableSettings {
  const columns = Array.isArray(settings?.columns)
    ? settings.columns
        .filter((column) => column?.field)
        .map((column) => ({
          field: column.field,
          header: column.header || humanizeFieldName(column.field),
          component: column.component,
          relatedCollection: column.relatedCollection,
          format: column.format,
          template: column.template,
          enabled: column.enabled !== false,
          ...(column.inlineEditable === true ? { inlineEditable: true } : {}),
        }))
    : []
  const sortField = settings?.sort?.field
  const sortOrder = settings?.sort?.order === -1 ? -1 : 1
  const groupField = settings?.groupBy?.field?.trim()
  const recordLinkField = settings?.recordLinkField?.trim() || null
  const rowLimit = parseRelatedRowLimit(settings?.rowLimit)

  const detailPanel = normalizeDetailPanel(settings?.detailPanel)
  const inlineEditRefresh = normalizeInlineEditRefresh(settings?.inlineEditRefresh)
  const inlineEditRefreshFields = normalizeInlineEditRefreshFields(
    settings?.inlineEditRefreshFields,
    columns,
  )
  const barcodeScan = normalizeBarcodeScanSettings(settings?.barcodeScan)

  return {
    columns,
    sort: sortField ? { field: sortField, order: sortOrder } : null,
    groupBy: groupField
      ? {
          field: groupField,
          expandable: settings?.groupBy?.expandable !== false,
        }
      : null,
    recordLinkField,
    relatedTransfer: settings?.relatedTransfer ?? null,
    actions: normalizeListViewActions(settings?.actions),
    detailPanel,
    ...(rowLimit !== undefined && rowLimit !== DEFAULT_RELATED_ROW_LIMIT
      ? { rowLimit }
      : {}),
    ...(inlineEditRefresh !== 'off' ? { inlineEditRefresh } : {}),
    ...(inlineEditRefresh === 'fields' && inlineEditRefreshFields.length
      ? { inlineEditRefreshFields }
      : {}),
    ...(barcodeScan ? { barcodeScan } : {}),
  }
}

function normalizeInlineEditRefresh(
  value: DataTableSettings['inlineEditRefresh'],
): 'off' | 'row' | 'fields' {
  if (value === 'row' || value === 'fields') return value
  return 'off'
}

function normalizeInlineEditRefreshFields(
  value: DataTableSettings['inlineEditRefreshFields'],
  columns: DataTableColumnConfig[],
): string[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set(columns.map((column) => column.field))
  const seen = new Set<string>()
  const fields: string[] = []
  for (const raw of value) {
    const field = String(raw ?? '').trim()
    if (!field || seen.has(field)) continue
    if (allowed.size > 0 && !allowed.has(field)) continue
    seen.add(field)
    fields.push(field)
  }
  return fields
}

export function normalizeListViewActions(
  actions: DataTableSettings['actions'],
): ListViewAction[] | null {
  if (!Array.isArray(actions) || actions.length === 0) return null

  const normalized = actions
    .map((action, index): ListViewAction | null => {
      if (!action || typeof action !== 'object') return null
      const label = String(action.label ?? '').trim()
      if (!label) return null
      const id = String(action.id ?? '').trim() || `list_action_${index + 1}`
      const templateId = action.document?.templateId?.trim() || null
      const viewMode = action.document?.viewMode === 'html' ? 'html' : 'pdf'
      const recordScope = action.recordScope === 'visible' ? 'visible' : 'filtered'
      return {
        id,
        label,
        behavior: 'openDocument',
        document: {
          templateId,
          viewMode,
          skipInteractiveFill: action.document?.skipInteractiveFill !== false,
        },
        recordScope,
      }
    })
    .filter((action): action is ListViewAction => action !== null)

  return normalized.length > 0 ? normalized : null
}

function normalizeDetailPanel(
  panel: DataTableSettings['detailPanel'],
): DataTableSettings['detailPanel'] {
  if (!panel || typeof panel !== 'object') return null

  const blockLayoutId = panel.blockLayoutId?.trim() || null
  const relatedFieldId = panel.relatedFieldId?.trim() || null
  const relatedCollection = panel.relatedCollection?.trim() || ''

  // Prefer Block Layout; keep legacy relatedCollection-only configs working.
  if (!blockLayoutId && !relatedCollection) return null

  const masterSize =
    typeof panel.masterSize === 'number' && panel.masterSize > 0 && panel.masterSize < 100
      ? panel.masterSize
      : undefined
  const detailMinSize =
    typeof panel.detailMinSize === 'number' && panel.detailMinSize >= 0 && panel.detailMinSize < 100
      ? panel.detailMinSize
      : undefined

  return {
    enabled: panel.enabled === true,
    ...(blockLayoutId ? { blockLayoutId } : {}),
    ...(relatedFieldId ? { relatedFieldId } : {}),
    ...(relatedCollection ? { relatedCollection } : {}),
    ...(panel.label?.trim() ? { label: panel.label.trim() } : {}),
    ...(panel.dataTable
      ? {
          dataTable: normalizeTableSettings({
            ...panel.dataTable,
            detailPanel: null,
          }),
        }
      : {}),
    ...(masterSize !== undefined ? { masterSize } : {}),
    ...(detailMinSize !== undefined ? { detailMinSize } : {}),
    ...(panel.defaultCollapsed === true ? { defaultCollapsed: true } : {}),
  }
}

export function usesPrimaryKeyRecordLink(
  recordLinkField: string | null | undefined,
  primaryKey: string,
): boolean {
  const linkField = recordLinkField?.trim()
  if (!linkField) return true
  return linkField === primaryKey
}

/** Default auto link column: Name when unset; primary key when explicitly chosen. */
export function resolveAutoRecordLinkField(
  recordLinkField: string | null | undefined,
  primaryKey: string,
  hasNameField = true,
): string {
  const linkField = recordLinkField?.trim()
  if (!linkField) {
    return hasNameField ? 'name' : primaryKey
  }
  if (linkField === primaryKey) {
    return primaryKey
  }
  return linkField
}

export function buildDataTableSortFields(
  groupBy: DataTableGroupConfig | null | undefined,
  sort: DataTableSortConfig | null | undefined,
  isValidField: (fieldPath: string) => boolean,
): string[] {
  const sorts: string[] = []
  const groupField = groupBy?.field?.trim()

  if (groupField && isValidField(groupField)) {
    sorts.push(groupField)
  }

  const sortField = sort?.field?.trim()
  if (sortField && isValidField(sortField) && sortField !== groupField) {
    const order = sort?.order === -1 ? -1 : 1
    sorts.push(`${order === -1 ? '-' : ''}${sortField}`)
  }

  return sorts
}

export function dataTableSortQuery(
  groupBy: DataTableGroupConfig | null | undefined,
  sort: DataTableSortConfig | null | undefined,
  fieldByName: Map<string, FieldDefinition>,
): Record<string, unknown> {
  const isValidField = (fieldPath: string) =>
    fieldByName.has(fieldPath.split('.')[0] ?? '')

  const sortFields = buildDataTableSortFields(groupBy, sort, isValidField)
  if (sortFields.length === 0) return {}

  return { sort: sortFields }
}

async function readTableSettingRecord(
  collection: string,
): Promise<TableSettingRecord | null> {
  return readSettingRecord<TableSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
    limit: 1,
  })
}

function humanizeFieldName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}
