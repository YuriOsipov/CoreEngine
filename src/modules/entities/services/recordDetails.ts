import {
  bridgeDeleteItem,
  bridgeReadItem,
  bridgeRestoreItem,
  bridgeSoftDeleteItem,
  bridgeUpdateItem,
} from '@/core/graphql/itemsBridge'
import { readAggregateRecordsBridge } from '@/core/graphql/dashboardsApi'
import { triggerFlow } from '@/core/graphql/flowsProxy'
import { applyCloneRelatedFromLayout } from '@/modules/entities/services/cloneRelatedFromSource'
import { writeCreateItem } from '@/modules/entities/services/recordWrites'
import type { CompactRecordDetailsSchema } from '@/modules/config/services/layoutSettings'
import {
  loadCompactRecordDetailsById,
  loadCompactRecordDetailsSetting,
} from '@/modules/config/services/layoutSettings'
import {
  fetchFieldRuntimeMetadata,
  fetchTranslatedFieldLabel,
  getCachedCollectionFields,
  getCachedRelations,
  fetchRelatedCollectionOptionById,
} from './collectionSchema'
import { aggregateCount } from '@/core/aggregateCount'
import { isUsersAssetCollection } from '@/core/usersField'
import {
  effectiveDateDisplayFormat,
  formatDateValue,
  isDateComponent,
} from '@/core/dateFormatting'
import {
  DISPLAY_FIELD_CANDIDATES,
  formatDisplayValue,
  relatedRecordDisplayField,
} from '../utils/recordDisplay'
import { isFieldM2O } from '../utils/relatedTransferSchema'
import { findRelationForField } from '../utils/fieldMapper'
import { buildM2ARequestFields, buildM2ARequestFieldsFallback, isFieldM2A, resolveM2AMetadata } from '../utils/m2aSchema'
import {
  isFieldM2M,
  m2mJunctionFieldName,
} from '../utils/m2mSchema'
import { appendFileRequestFields } from '@/core/filesField'
import { isFilesField, isM2MMultiSelectField } from '@/core/fieldHelpers'
import { isClientOnlyLayoutField } from '@/core/layoutFieldRules'
import {
  collectShowIfFieldPaths,
  showIfRequestFields,
} from '@/core/recordConditionMatch'
import { keysEqual } from '@/core/utils/object'
import type {
  FieldDefinition,
  RelationDefinition,
  EntityLayoutSchema,
  LayoutFieldMetadata,
} from '@/interfaces'
import type { EntityAction } from '@/interfaces'

const ARCHIVED_STATUS_VALUES = ['archived', 'Archived']

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

export function isRecordArchived(
  record: Record<string, unknown> | null | undefined,
): boolean {
  if (!record) return false
  if (isTruthyFlag(record.is_deleted)) return true
  const status = record.status
  if (status === null || status === undefined) return false
  return ARCHIVED_STATUS_VALUES.includes(String(status))
}
export interface CompactRecordRuntimeField {
  id: string
  field: string
  label: string
  value: string
}

export interface CompactRecordRuntimeCount {
  id: string
  label: string
  relatedCollection: string
  count: number
}

export interface CompactRecordDetailsRuntime {
  collection: string
  id: string | number
  schema: CompactRecordDetailsSchema | null
  fields: CompactRecordRuntimeField[]
  relatedCounts: CompactRecordRuntimeCount[]
}

interface CompactRecordDetailsOptions {
  includeRelatedCounts?: boolean
  /** When set, load this Compact Layout by Setting id instead of role resolution. */
  compactLayoutId?: string | null
}

export async function fetchObjectRecord(
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  const definitions = await getCachedCollectionFields(collection)
  const nestedBaseFields = baseRecordFieldsForCollection(definitions).filter(
    (field) => field.includes('.'),
  )
  const fields = ['*', ...nestedBaseFields]

  return bridgeReadItem(collection, id, { fields })
}

function collectionHasField(
  fieldName: string,
  definitions: FieldDefinition[],
): boolean {
  return definitions.some((item) => keysEqual(item.field, fieldName))
}

function baseRecordFieldsForCollection(
  definitions: FieldDefinition[],
): string[] {
  const fields: string[] = []

  if (collectionHasField('id', definitions)) {
    fields.push('id')
  }

  if (collectionHasField('date_created', definitions)) {
    fields.push('date_created')
  }

  if (collectionHasField('date_updated', definitions)) {
    fields.push('date_updated')
  }

  if (collectionHasField('is_deleted', definitions)) {
    fields.push('is_deleted')
  }

  if (collectionHasField('is_active', definitions)) {
    fields.push('is_active')
  }

  if (collectionHasField('status', definitions)) {
    fields.push('status')
  }

  if (collectionHasField('user_created', definitions)) {
    fields.push(
      'user_created.id',
      'user_created.first_name',
      'user_created.last_name',
      'user_created.avatar',
    )
  }

  if (collectionHasField('user_updated', definitions)) {
    fields.push(
      'user_updated.id',
      'user_updated.first_name',
      'user_updated.last_name',
      'user_updated.avatar',
    )
  }

  if (fields.length === 0) {
    return ['id']
  }

  return fields
}

function appendM2ORequestFields(
  requestFields: Set<string>,
  fieldName: string,
  relatedFields: FieldDefinition[],
  relatedCollection?: string | null,
): void {
  requestFields.add(`${fieldName}.id`)

  if (isUsersAssetCollection(String(relatedCollection || ''))) {
    for (const nestedField of ['first_name', 'last_name', 'email'] as const) {
      requestFields.add(`${fieldName}.${nestedField}`)
    }
    return
  }

  const displayField = relatedRecordDisplayField(relatedFields)
  if (displayField !== 'id') {
    requestFields.add(`${fieldName}.${displayField}`)
  }

  for (const candidate of DISPLAY_FIELD_CANDIDATES) {
    if (candidate === 'id' || candidate === displayField) continue
    if (collectionHasField(candidate, relatedFields)) {
      requestFields.add(`${fieldName}.${candidate}`)
    }
  }
}

async function collectLayoutRequestFields(
  collection: string,
  schema: EntityLayoutSchema,
  fields: FieldDefinition[],
  relations: RelationDefinition[],
  extraFields: LayoutFieldMetadata[] = [],
): Promise<string[]> {
  const requestFields = new Set<string>(baseRecordFieldsForCollection(fields))
  const layoutFields = [
    ...schema.sections.flatMap((section) =>
      section.groups.flatMap((group) => group.fields),
    ),
    ...extraFields,
  ]

  for (const path of showIfRequestFields(collectShowIfFieldPaths(schema.sections))) {
    requestFields.add(path)
  }

  for (const field of layoutFields) {
    if (isClientOnlyLayoutField(field)) continue
    if (!isFilesField(field) && !collectionHasField(field.field, fields)) continue

    requestFields.add(field.field)

    if (isFilesField(field)) {
      appendFileRequestFields(requestFields, field)
      continue
    }

    if (
      isM2MMultiSelectField(field) ||
      isFieldM2M(collection, field.field, fields, relations)
    ) {
      const junctionField = m2mJunctionFieldName(
        collection,
        field.field,
        relations,
      )
      if (junctionField) {
        requestFields.add(`${field.field}.${junctionField}.*`)
      }
      continue
    }

    if (isFieldM2O(collection, field.field, fields, relations)) {
      const definition = fields.find((item) => keysEqual(item.field, field.field))
      const relation = definition
        ? findRelationForField(definition, relations)
        : undefined
      const relatedCollection = relation?.related_collection
      const relatedFields = relatedCollection
        ? await getCachedCollectionFields(relatedCollection)
        : []
      appendM2ORequestFields(
        requestFields,
        field.field,
        relatedFields,
        relatedCollection,
      )
      continue
    }

    if (!isFieldM2A(collection, field.field, fields, relations)) continue

    const metadata = resolveM2AMetadata(collection, field.field, fields, relations)
    const nestedFields = metadata
      ? buildM2ARequestFields(metadata)
      : buildM2ARequestFieldsFallback(field.field)
    for (const nestedField of nestedFields) {
      requestFields.add(nestedField)
    }
  }

  return Array.from(requestFields)
}

export async function fetchObjectRecordForEdit(
  collection: string,
  id: string,
  schema: EntityLayoutSchema,
  extraFields: LayoutFieldMetadata[] = [],
): Promise<Record<string, unknown>> {
  const fields = await getCachedCollectionFields(collection)
  const relations = (await getCachedRelations()) as RelationDefinition[]
  const requestFields = await collectLayoutRequestFields(
    collection,
    schema,
    fields,
    relations,
    extraFields,
  )

  return bridgeReadItem(collection, id, { fields: requestFields })
}

export async function fetchCompactRecordDetails(
  collection: string,
  id: string | number,
  options: CompactRecordDetailsOptions = {},
): Promise<CompactRecordDetailsRuntime> {
  const schema = options.compactLayoutId
    ? await loadCompactRecordDetailsById(collection, options.compactLayoutId)
    : await loadCompactRecordDetailsSetting(collection)
  if (!schema) {
    return {
      collection,
      id,
      schema: null,
      fields: [],
      relatedCounts: [],
    }
  }

  const requestFields = Array.from(
    new Set(['id', ...schema.fields.map((field) => field.field)]),
  )
  const record = await bridgeReadItem(collection, String(id), {
    fields: requestFields,
  })
  const fields = await Promise.all(
    schema.fields.map(async (field) => ({
      id: field.id,
      field: field.field,
      label: await fetchTranslatedFieldLabel(collection, field.field, field.label),
      value: await displayCompactFieldValue(
        collection,
        field,
        record[field.field],
      ),
    })),
  )
  const relatedCounts =
    options.includeRelatedCounts === false
      ? []
      : await Promise.all(
          schema.relatedCounts.map(async (item) => ({
            id: item.id,
            label: await fetchTranslatedFieldLabel(collection, item.field, item.label),
            relatedCollection: item.relatedCollection,
            count: await countRelatedRecords(
              collection,
              id,
              item.relatedCollection,
              item.field,
            ),
          })),
        )

  return {
    collection,
    id,
    schema,
    fields,
    relatedCounts,
  }
}

export async function updateObjectRecord(
  collection: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let previous: Record<string, unknown> | null = null
  try {
    previous = await bridgeReadItem(collection, id)
  } catch {
    previous = null
  }
  const updated = await bridgeUpdateItem(collection, id, payload)
  await applyCloneRelatedFromLayout(collection, updated, previous)
  return updated
}

export async function createObjectRecord(
  collection: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const created = await writeCreateItem(collection, payload)
  await applyCloneRelatedFromLayout(collection, created, null)
  return created
}

export async function archiveObjectRecord(
  collection: string,
  id: string,
): Promise<void> {
  await bridgeSoftDeleteItem(collection, id)
}

export async function restoreObjectRecord(
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  return bridgeRestoreItem(collection, id)
}

export async function hardDeleteObjectRecord(
  collection: string,
  id: string,
): Promise<void> {
  await bridgeDeleteItem(collection, id)
}

export async function triggerFlowAction(
  action: EntityAction,
  collection: string,
  id: string,
  record: Record<string, unknown>,
): Promise<unknown> {
  const webhook = action.flow?.webhook?.trim()
  if (!webhook) {
    throw new Error('Flow webhook is not configured for this action.')
  }

  return triggerFlow(webhook, buildFlowActionPayload(action, collection, id, record))
}


function buildFlowActionPayload(
  action: EntityAction,
  collection: string,
  id: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    action: {
      id: action.id,
      name: action.name,
      label: action.label,
    },
  }

  if (action.payload?.includeCollection !== false) {
    payload.collection = collection
  }
  if (action.payload?.includeRecordId !== false) {
    payload.recordId = id
  }
  if (action.payload?.includeRecord === true) {
    payload.record = record
  }

  return payload
}

async function displayCompactFieldValue(
  collection: string,
  field: CompactRecordDetailsSchema['fields'][number],
  value: unknown,
): Promise<string> {
  const dateFormat = await compactDateFormat(collection, field)
  if (dateFormat) {
    return formatDateValue(value, dateFormat)
  }

  if (
    field.relatedCollection &&
    (typeof value === 'string' || typeof value === 'number') &&
    value !== ''
  ) {
    const metadata = await fetchFieldRuntimeMetadata(
      collection,
      field.field,
      field.component,
    )
    const option = await fetchRelatedCollectionOptionById(
      field.relatedCollection,
      value,
      metadata.template,
    )
    return option?.label ?? formatCompactValue(value)
  }

  if (isChoiceComponent(field.component)) {
    const metadata = await fetchFieldRuntimeMetadata(
      collection,
      field.field,
      field.component,
    )
    const labels = choiceLabels(metadata.props.options)
    if (Array.isArray(value)) {
      return value
        .map((item) => labels.get(String(item)) ?? formatCompactValue(item))
        .join(', ')
    }
    return labels.get(String(value)) ?? formatCompactValue(value)
  }

  return formatCompactValue(value)
}

async function compactDateFormat(
  collection: string,
  field: CompactRecordDetailsSchema['fields'][number],
): Promise<string | undefined> {
  if (!isDateComponent(field.component)) return undefined

  const fields = await getCachedCollectionFields(collection) as FieldDefinition[]
  const definition = fields.find((item) => item.field === field.field)
  return effectiveDateDisplayFormat(field.format, definition)
}

async function countRelatedRecords(
  parentCollection: string,
  parentId: string | number,
  relatedCollection: string,
  relatedField: string,
): Promise<number> {
  const [relationsRaw, fieldsRaw] = await Promise.all([
    getCachedRelations(),
    getCachedCollectionFields(relatedCollection),
  ])
  const relations = relationsRaw as unknown as RelationDefinition[]
  const fields = fieldsRaw as unknown as FieldDefinition[]
  const parentRelation = bestRelatedCountRelation(
    relations.filter(
      (relation) =>
        relationCollectionName(relation) === relatedCollection &&
        (relation.related_collection === parentCollection ||
          relation.meta?.one_collection === parentCollection),
    ),
    relatedCollection,
    relatedField,
  )
  const parentField = parentRelation?.field ?? parentRelation?.meta?.many_field
  if (!parentField) return 0

  const filters: Record<string, unknown>[] = [
    {
      [parentField]: {
        _eq: parentId,
      },
    },
  ]
  if (fields.some((field) => field.field === 'is_deleted')) {
    filters.push({
      is_deleted: {
        _neq: true,
      },
    })
  } else if (fields.some((field) => field.field === 'status')) {
    filters.push({
      status: {
        _nin: ARCHIVED_STATUS_VALUES,
      },
    })
  }
  const filter =
    filters.length === 1
      ? filters[0]
      : {
          _and: filters,
        }

  const response = await readAggregateRecordsBridge({
    entity: relatedCollection,
    aggregate: { count: '*' },
    filter,
    limit: -1,
  })

  return aggregateCount(response)
}

function relationCollectionName(relation: RelationDefinition): string {
  return relation.meta?.many_collection || relation.collection
}

function bestRelatedCountRelation(
  relations: RelationDefinition[],
  relatedCollection: string,
  relatedField: string,
): RelationDefinition | undefined {
  return [...relations].sort((left, right) =>
    relationMatchScore(right, relatedCollection, relatedField) -
    relationMatchScore(left, relatedCollection, relatedField),
  )[0]
}

function relationMatchScore(
  relation: RelationDefinition,
  relatedCollection: string,
  relatedField: string,
): number {
  if (relation.meta?.one_field === relatedField) return 4
  if (relation.field === relatedField || relation.meta?.many_field === relatedField) {
    return 3
  }
  if (`${relatedCollection}_${relation.field}` === relatedField) return 2
  if (`${relationCollectionName(relation)}_${relation.field}` === relatedField) {
    return 1
  }
  return 0
}

function isChoiceComponent(component: string): boolean {
  return ['Select', 'Dropdown', 'RadioButton', 'SelectButton', 'MultiSelect'].includes(
    component,
  )
}

function choiceLabels(options: unknown): Map<string, string> {
  const labels = new Map<string, string>()
  if (!Array.isArray(options)) return labels

  for (const option of options) {
    if (!option || typeof option !== 'object') continue
    const candidate = option as Record<string, unknown>
    if (candidate.value === undefined) continue
    labels.set(
      String(candidate.value),
      typeof candidate.label === 'string'
        ? candidate.label
        : String(candidate.value),
    )
  }

  return labels
}

function formatCompactValue(value: unknown): string {
  return formatDisplayValue(value, { emptyValue: '-' })
}
