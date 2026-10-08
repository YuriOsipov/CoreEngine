import type {
  FieldDefinition,
  RelationDefinition,
  EntityLayoutSchema,
} from '@/interfaces'
import {
  getCachedCollectionFields,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import {
  extractRelationFieldId,
} from '@/modules/entities/utils/recordDisplay'
import { isFieldM2O } from '@/modules/entities/utils/relatedTransferSchema'
import { isFieldM2A } from '@/modules/entities/utils/m2aSchema'
import {
  isAddressFieldDefinition,
  normalizeAddressValue,
} from '@/core/addressField'
import {
  isRepeaterFieldDefinition,
} from '@/core/repeaterField'
import { serializeDateFieldValue } from '@/core/dateFormatting'

function isNumericFieldType(type: string): boolean {
  return ['float', 'decimal', 'integer', 'bigInteger'].includes(type)
}

export async function normalizeEntityFormFieldValue(
  collection: string,
  fieldName: string,
  value: unknown,
  fields: FieldDefinition[],
  relations: RelationDefinition[],
): Promise<unknown> {
  if (isFieldM2O(collection, fieldName, fields, relations)) {
    return extractRelationFieldId(value)
  }

  if (isFieldM2A(collection, fieldName, fields, relations)) {
    return value
  }

  const definition = fields.find((item) => item.field === fieldName)
  // Repeater = schedule rule JSON; persist verbatim (single object / rule payload).
  if (definition && isRepeaterFieldDefinition(definition)) {
    return value ?? null
  }

  if (definition && isAddressFieldDefinition(definition)) {
    return normalizeAddressValue(value)
  }

  if (definition && definition.type === 'json') {
    return value
  }

  if (
    definition &&
    isNumericFieldType(definition.type) &&
    value !== null &&
    value !== undefined &&
    value !== ''
  ) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }

  if (
    definition &&
    ['date', 'dateTime', 'timestamp', 'time'].includes(definition.type)
  ) {
    return serializeDateFieldValue(value, definition.type)
  }

  return value
}

export async function normalizeEntityFormDraft(
  collection: string,
  schema: EntityLayoutSchema,
  draft: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await getCachedCollectionFields(collection)
  const relations = (await getCachedRelations()) as RelationDefinition[]
  let next: Record<string, unknown> | null = null

  for (const section of schema.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        if (!Object.prototype.hasOwnProperty.call(draft, field.field)) continue

        const raw = draft[field.field]
        const normalized = await normalizeEntityFormFieldValue(
          collection,
          field.field,
          raw,
          fields,
          relations,
        )
        if (!Object.is(raw, normalized)) {
          if (!next) next = { ...draft }
          next[field.field] = normalized
        }
      }
    }
  }

  return next ?? draft
}

export function mergeRelationScalarsFromRow(
  draft: Record<string, unknown>,
  row: Record<string, unknown> | null | undefined,
  schema: EntityLayoutSchema,
  fields: FieldDefinition[],
  relations: RelationDefinition[],
  collection: string,
): Record<string, unknown> {
  if (!row) return draft

  let next: Record<string, unknown> | null = null

  for (const section of schema.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        if (isFieldM2O(collection, field.field, fields, relations)) {
          const current = next ? next[field.field] : draft[field.field]
          const draftId = extractRelationFieldId(current)
          const rowId = extractRelationFieldId(row[field.field])
          if (rowId === null) continue

          const draftMissing = draftId === null
          if (draftMissing && rowId !== draftId) {
            if (!next) next = { ...draft }
            next[field.field] = rowId
          }
          continue
        }

        if (!isFieldM2A(collection, field.field, fields, relations)) continue

        const current = next ? next[field.field] : draft[field.field]
        const rowValue = row[field.field]
        const draftEmpty = !Array.isArray(current) || current.length === 0
        if (draftEmpty && Array.isArray(rowValue) && rowValue.length > 0) {
          if (!next) next = { ...draft }
          next[field.field] = rowValue
        }
      }
    }
  }

  return next ?? draft
}

export async function prepareEntityFormDraft(
  collection: string,
  schema: EntityLayoutSchema,
  draft: Record<string, unknown>,
  sourceRow?: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const fields = await getCachedCollectionFields(collection)
  const relations = (await getCachedRelations()) as RelationDefinition[]
  const merged = mergeRelationScalarsFromRow(
    draft,
    sourceRow,
    schema,
    fields,
    relations,
    collection,
  )
  return normalizeEntityFormDraft(collection, schema, merged)
}
