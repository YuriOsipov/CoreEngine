import type { FieldDefinition, RelationDefinition } from '@/interfaces'
import { readPath } from '@/core/utils/object'
import {
  fetchCollectionDisplayTemplate,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import {
  extractTemplateFields,
  formatDisplayValue,
  relatedRecordDisplayField,
  relatedRecordFallbackLabel,
  renderTemplateLabel,
  shouldUseTemplateForRelatedLabel,
} from '@/modules/entities/utils/recordDisplay'

export interface LookupLabelMetadata {
  field: string
  template?: string
  requestFields: string[]
}

export type CollectionFieldsLoader = (
  collection: string,
) => Promise<FieldDefinition[] | null>

export type RelationCollectionResolver = (
  collection: string,
  field: string,
  fields: FieldDefinition[] | null,
) => Promise<string | null>

export function resolveFieldPath(
  fields: FieldDefinition[] | null,
  path: string,
): string {
  if (!fields || !path) return path
  const [first, ...rest] = path.split('.')
  const field = fields.find((item) => keysEqual(item.field, first))?.field ?? first
  return [field, ...rest].filter(Boolean).join('.')
}

export async function lookupLabelMetadata(
  lookupCollection: string,
  fields: FieldDefinition[] | null,
  labelField: string,
  collectionFields: CollectionFieldsLoader,
  relationCollectionForField: RelationCollectionResolver = defaultRelationCollectionForField,
): Promise<LookupLabelMetadata> {
  const parts = labelField.split('.').filter(Boolean)
  const rootField = parts[0] ?? labelField
  const definition = fields?.find((field) => keysEqual(field.field, rootField))
  const resolvedRoot = definition?.field ?? rootField

  if (parts.length > 1) {
    const relatedCollection = await relationCollectionForField(lookupCollection, resolvedRoot, fields)
    const nestedSegment = parts[1]
    if (relatedCollection) {
      const relatedFields = await collectionFields(relatedCollection)
      const nestedDefinition = relatedFields?.find((field) =>
        keysEqual(field.field, nestedSegment),
      )
      const template = fieldDisplayTemplate(nestedDefinition)
      const templateFields = template ? extractTemplateFields(template) : []
      const displayField = relatedRecordDisplayField(relatedFields ?? [])
      const nestedFields = templateFields.length > 0 ? templateFields : [displayField]
      const resolvedNested = nestedDefinition?.field ?? nestedSegment
      return {
        field: labelField,
        template,
        requestFields: [
          resolvedRoot,
          `${resolvedRoot}.id`,
          `${resolvedRoot}.${resolvedNested}`,
          ...nestedFields.map((field) => `${resolvedRoot}.${field}`),
        ],
      }
    }

    return {
      field: labelField,
      requestFields: [labelField],
    }
  }

  const fieldTemplate = fieldDisplayTemplate(definition)
  const relatedCollection = await relationCollectionForField(lookupCollection, resolvedRoot, fields)

  if (relatedCollection) {
    const relatedFields = await collectionFields(relatedCollection)
    const template = fieldTemplate
    const templateFields = template ? extractTemplateFields(template) : []
    const displayField = relatedRecordDisplayField(relatedFields ?? [])
    const nestedFields = templateFields.length > 0 ? templateFields : [displayField]
    return {
      field: resolvedRoot,
      template,
      requestFields: [
        resolvedRoot,
        `${resolvedRoot}.id`,
        ...nestedFields.map((field) => `${resolvedRoot}.${field}`),
      ],
    }
  }

  // Direct related-entity picklist (valueField is typically PK): use collection Display Template.
  const collectionTemplate = fieldTemplate
    || (await fetchCollectionDisplayTemplate(lookupCollection))
  const templateFields = collectionTemplate ? extractTemplateFields(collectionTemplate) : []
  const displayField = relatedRecordDisplayField(fields ?? [])
  const isPrimaryKey = Boolean(definition?.schema?.is_primary_key) || keysEqual(resolvedRoot, 'id')

  return {
    field: collectionTemplate || !isPrimaryKey ? resolvedRoot : displayField,
    template: collectionTemplate,
    requestFields: Array.from(
      new Set([resolvedRoot, displayField, ...templateFields].filter(Boolean)),
    ),
  }
}

export function lookupOptionLabel(
  row: Record<string, unknown>,
  metadata: { field: string; template?: string },
  fallback: unknown,
  formatFallback: (value: unknown) => string = (value) =>
    formatDisplayValue(value, { emptyValue: '-' }),
): string {
  const value = metadata.field.includes('.')
    ? readPath(row, metadata.field)
    : row[metadata.field]
  const templateFields = metadata.template ? extractTemplateFields(metadata.template) : []
  if (
    metadata.template &&
    value &&
    typeof value === 'object' &&
    shouldUseTemplateForRelatedLabel(metadata.template, templateFields)
  ) {
    return renderTemplateLabel(metadata.template, value as Record<string, unknown>)
  }
  if (value && typeof value === 'object') {
    return relatedRecordFallbackLabel(value, fallback)
  }
  if (metadata.template && shouldUseTemplateForRelatedLabel(metadata.template, templateFields)) {
    return renderTemplateLabel(metadata.template, row)
  }
  return formatFallback(value ?? fallback)
}

export function fieldDisplayTemplate(
  definition: FieldDefinition | undefined,
): string | undefined {
  const template = definition?.meta?.options?.template
  return typeof template === 'string' && template.trim() ? template : undefined
}

export async function defaultRelationCollectionForField(
  collection: string,
  field: string,
  fields: FieldDefinition[] | null,
): Promise<string | null> {
  const definition = fields?.find((item) => keysEqual(item.field, field))
  const relations = await getCachedRelations() as RelationDefinition[]
  const relation = relations.find((item) =>
    keysEqual(item.collection, collection) &&
      item.field &&
      keysEqual(item.field, field),
  )
  return relation?.related_collection ??
    relation?.meta?.one_collection ??
    definition?.schema?.foreign_key_table ??
    null
}

export function keysEqual(left: string, right: string): boolean {
  return normalizeKey(left) === normalizeKey(right)
}

function normalizeKey(key: string): string {
  return key.replace(/[_\s-]/g, '').toLowerCase()
}
