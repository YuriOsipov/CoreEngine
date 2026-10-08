import type {
  CollectionDefinition,
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import {
  keysEqual,
  relationField,
  relationManyCollection,
  relationRelatedCollection,
} from '@/core/relationHelpers'
import { normalizeKey, resolveRecordKey } from '@/core/utils/object'
import { normalizeSpecial } from '@/modules/entities/utils/fieldMapper'
import {
  getCachedCollectionFields,
  getCachedCollections,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'

export { keysEqual, normalizeKey, resolveRecordKey }

export function resolveFieldPath(fields: FieldDefinition[] | null, path: string): string {
  if (!fields || !path) return path
  const [first, ...rest] = path.split('.')
  const field = fields.find((item) => keysEqual(item.field, first))?.field ?? first
  return [field, ...rest].filter(Boolean).join('.')
}

export function resolveFlatFieldPath(
  fields: FieldDefinition[] | null,
  parts: string[],
): string | null {
  if (!fields || parts.length < 2) return null
  const flatPath = parts.join('_')
  return fields.find((field) => keysEqual(field.field, flatPath))?.field ?? null
}

export function isParentRelation(
  relation: RelationDefinition,
  parentCollection: string,
  relationField: string,
): boolean {
  const relationCollection = relation.meta?.many_collection ?? relation.collection
  if (!keysEqual(relationCollection, parentCollection)) return false

  return [
    relation.field,
    relation.meta?.many_field,
    relation.meta?.one_field,
  ].some((field) => field ? keysEqual(field, relationField) : false)
}

export async function lookupParentCollection(
  propsParentCollection: string | undefined,
  resolvedTargetParentField: string,
  targetValueParentField: string | undefined,
): Promise<string | null> {
  const candidate = propsParentCollection ||
    resolvedTargetParentField ||
    targetValueParentField ||
    ''
  if (!candidate) return null
  return await resolveCollectionKey(candidate)
}

export async function resolveCollectionKey(collection: string): Promise<string> {
  const collections = await getCachedCollections() as CollectionDefinition[]
  const match = collections.find((item) =>
    keysEqual(item.collection, collection) ||
      Boolean(item.schema?.name && keysEqual(item.schema.name, collection)),
  )
  return match?.collection ?? collection
}

export function primaryKeyField(fields: FieldDefinition[] | null): string {
  return fields?.find((field) => field.schema?.is_primary_key)?.field ??
    fields?.find((field) => field.field === 'id')?.field ??
    'id'
}

export async function collectionFields(collection: string): Promise<FieldDefinition[] | null> {
  try {
    return await getCachedCollectionFields(collection)
  } catch {
    return null
  }
}

export async function relationCollectionForField(
  collection: string,
  field: string,
  fields: FieldDefinition[] | null,
): Promise<string | null> {
  const definition = fields?.find((item) => keysEqual(item.field, field))
  const relations = await getCachedRelations() as RelationDefinition[]
  const relation = relations.find((item) => isParentRelation(item, collection, field))
  return relation?.related_collection ??
    relation?.meta?.one_collection ??
    definition?.schema?.foreign_key_table ??
    null
}

export function parentHeaderDisplayFields(
  fields: FieldDefinition[] | null,
  primaryKey: string,
): string[] {
  if (!fields) return []
  const preferred = ['name', 'title', 'label', 'value']
    .map((key) => fields.find((field) => keysEqual(field.field, key))?.field)
    .filter((field): field is string => Boolean(field))
  if (preferred.length > 0) return preferred

  const fallback = fields.find((field) =>
    field.field !== primaryKey &&
      field.type !== 'alias' &&
      ['string', 'text'].includes(field.type),
  )
  return fallback ? [fallback.field] : []
}

export function parentHeaderRecordLabel(row: Record<string, unknown>, primaryKey: string): unknown {
  for (const key of ['name', 'title', 'label', 'value']) {
    const recordKey = resolveRecordKey(row, key)
    if (recordKey && row[recordKey] !== undefined && row[recordKey] !== null) {
      return row[recordKey]
    }
  }
  return row[primaryKey]
}

export function isFieldM2O(
  collection: string,
  fieldName: string,
  fields: FieldDefinition[] | null | undefined,
  relations: RelationDefinition[],
): boolean {
  if (!collection || !fieldName) return false

  const field = fields?.find((item) => keysEqual(item.field, fieldName))
  const relation = relations.find((item) =>
    keysEqual(relationManyCollection(item), collection) &&
    keysEqual(relationField(item), fieldName),
  )
  const special = normalizeSpecial(field?.meta?.special)
  if (special.includes('m2m') || special.includes('o2m') || special.includes('m2a')) {
    return false
  }
  return special.includes('m2o') ||
    Boolean(relationRelatedCollection(relation) || relation?.related_collection)
}
