import type {
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import type { PrimeVueComponentType } from '@/interfaces'
import {
  readSettingRecord,
  writeSettingUpsert,
} from '@/core/graphql/settingRecordsBridge'
import {
  fetchTranslatedFieldLabel,
  getCachedCollectionFields,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import {
  findRelationForField,
  mapFieldTypeToComponent,
} from '@/modules/entities/utils/fieldMapper'

const SETTINGS_GROUP = 'list'
const SETTINGS_SUB_GROUP = 'full'
const EXCLUDED_FILTER_FIELDS_BY_COLLECTION: Record<string, string[]> = {
  recent_record_views: ['record_label'],
}

export type FilterLogic = 'and' | 'or'

export interface ListFilterCondition {
  id: string
  field: string
  operator: string
  value: unknown
  /** Field type used when resolving dynamic values and query formatting. */
  type?: string
  /** When false, condition applies in saved filter but is hidden from list-page value editor. */
  userVisible?: boolean
  /** When true, list shows no rows until this condition has a non-empty value. */
  required?: boolean
  /** Grid column span (1–12) on the list-page filter row layout. Default: 4. */
  fieldWidth?: number
}

export interface SavedListFilter {
  id: string
  name: string
  logic: FilterLogic
  conditions: ListFilterCondition[]
}

export const ALL_RECORDS_FILTER_ID = '__all_records__'

export const ALL_RECORDS_FILTER: SavedListFilter = {
  id: ALL_RECORDS_FILTER_ID,
  name: 'All records',
  logic: 'and',
  conditions: [],
}

export interface FilterableField {
  field: string
  label: string
  type: string
  component: PrimeVueComponentType
  relatedCollection?: string
}

interface ListFilterSettingsBody {
  filters?: SavedListFilter[]
}

interface ListFilterSettingRecord {
  id: number | string
  collection: string
  group: string
  name?: string
  sub_group: string
  body?: ListFilterSettingsBody | SavedListFilter[] | string | null
}

type ListFilterSettingInput = SavedListFilter & {
  filter?: Record<string, unknown>
}

export async function loadListFilters(
  collection: string,
): Promise<SavedListFilter[]> {
  const record = await readListFilterSettingRecord(collection)
  if (!record?.body) return []

  const body =
    typeof record.body === 'string'
      ? (JSON.parse(record.body) as ListFilterSettingsBody | SavedListFilter[])
      : record.body

  const filters = Array.isArray(body) ? body : (body.filters ?? [])
  return filters.map(normalizeSavedListFilter)
}

export async function saveListFilters(
  collection: string,
  filters: SavedListFilter[],
): Promise<void> {
  const body = {
    filters: filters.map(normalizeSavedListFilter),
  }
  const existing = await readListFilterSettingRecord(collection)

  await writeSettingUpsert({
    settingId: existing ? String(existing.id) : null,
    entityApiName: collection,
    groupKey: SETTINGS_GROUP,
    subGroup: SETTINGS_SUB_GROUP,
    name: collection,
    body: body as unknown as Record<string, unknown>,
  })
}

export async function listFilterableFields(
  collection: string,
): Promise<FilterableField[]> {
  const [fieldsRaw, relationsRaw] = await Promise.all([
    getCachedCollectionFields(collection),
    getCachedRelations(),
  ])
  const fields = fieldsRaw as unknown as FieldDefinition[]
  const relations = relationsRaw as unknown as RelationDefinition[]

  const filterableFields = fields
    .map((field) => {
      const relation = findRelationForField(field, relations)
      return {
        field,
        relation,
        component: mapFieldTypeToComponent(field, relation),
      }
    })
    .filter((item) => {
      const { field, component } = item
      if (field.meta?.hidden) return false
      if (field.type === 'alias') return false
      if (isExcludedFilterField(collection, field.field)) return false
      if (['user_updated', 'date_updated'].includes(field.field)) return false
      if (!component) return false
      return true
    })
    .map(({ field, relation, component }) => ({
      field: field.field,
      label: field.meta?.note?.trim() || humanizeFieldName(field.field),
      type: field.type,
      component: component as PrimeVueComponentType,
      relatedCollection:
        component === 'AutoComplete' && relation?.related_collection
          ? relation.related_collection
          : undefined,
    }))

  const translatedFields = await Promise.all(
    filterableFields.map(async (field) => ({
      ...field,
      label: await fetchTranslatedFieldLabel(collection, field.field, field.label),
    })),
  )

  return translatedFields.sort((a, b) => a.label.localeCompare(b.label))
}

async function readListFilterSettingRecord(
  collection: string,
): Promise<ListFilterSettingRecord | null> {
  return readSettingRecord<ListFilterSettingRecord>({
    collection,
    groups: [SETTINGS_GROUP],
    subGroup: SETTINGS_SUB_GROUP,
    limit: 1,
  })
}

function humanizeFieldName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function isExcludedFilterField(collection: string, field: string): boolean {
  return EXCLUDED_FILTER_FIELDS_BY_COLLECTION[collection]?.includes(field) ?? false
}

export const DEFAULT_FILTER_FIELD_WIDTH = 4

export function normalizeConditionFieldWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined
  const span = Math.min(12, Math.max(1, Math.round(value)))
  return span === DEFAULT_FILTER_FIELD_WIDTH ? undefined : span
}

export function resolveConditionFieldWidth(value: unknown): number {
  const normalized = normalizeConditionFieldWidth(value)
  if (normalized) return normalized
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return Math.min(12, Math.max(1, Math.round(value)))
  }
  return DEFAULT_FILTER_FIELD_WIDTH
}

function normalizeSavedListFilter(
  filter: ListFilterSettingInput,
): SavedListFilter {
  return {
    id: filter.id,
    name: filter.name,
    logic: filter.logic,
    conditions: filter.conditions.map((condition) => ({
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
    })),
  }
}
