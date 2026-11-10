import type { EntityLayoutSchema } from '@/interfaces'
import { normalizeEntityFormFieldValue } from '@/core/entityFormValues'
import { isWritableLayoutField } from '@/core/layoutFieldRules'
import {
  applyCalculatedFields,
  formulaValuesEqual,
  resolveFieldFormula,
} from '@/core/calculatedFields'
import {
  getCachedCollectionFields,
  getCachedRelations,
  isCollectionFieldReadonly,
} from '@/modules/entities/services/collectionSchema'
import { isFieldM2O } from '@/modules/entities/utils/relatedTransferSchema'
import { isFieldM2A, normalizeM2AFieldValue } from '@/modules/entities/utils/m2aSchema'
import {
  isFieldM2M,
  m2mJunctionFieldName,
  m2mOptionsToNestedPayload,
} from '@/modules/entities/utils/m2mSchema'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'
import { filesItemsToO2MPayload, singleFileM2OPayload } from '@/core/filesField'
import {
  isFilesField,
  isM2MMultiSelectField,
  isSingleFileField,
} from '@/core/fieldHelpers'
import type { RelationDefinition } from '@/interfaces'

type BuildFormPayloadOptions = {
  primaryKey?: string
  skipComponents?: string[]
}

async function shouldIncludeFieldInPayload(
  collection: string,
  field: string,
): Promise<boolean> {
  // Readonly / computed fields are display-only in forms; server hooks own persistence.
  return !(await isCollectionFieldReadonly(collection, field))
}

function normalizeComparableValue(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed
    }
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed) &&
      !/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)
    ) {
      return trimmed.slice(0, 19)
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const parsed = Date.parse(trimmed)
      if (!Number.isNaN(parsed)) {
        return new Date(parsed).toISOString()
      }
    }
    return trimmed
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeComparableValue(item))
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalized: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(record).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      normalized[key] = normalizeComparableValue(nestedValue)
    }
    return normalized
  }

  return String(value)
}

function formValuesEqual(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeComparableValue(left)
  const normalizedRight = normalizeComparableValue(right)

  if (normalizedLeft === normalizedRight) return true

  if (
    typeof normalizedLeft === 'object' &&
    normalizedLeft !== null &&
    typeof normalizedRight === 'object' &&
    normalizedRight !== null
  ) {
    try {
      return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
    } catch {
      return false
    }
  }

  return false
}

async function buildFormPayload(
  collection: string,
  schema: EntityLayoutSchema,
  draft: Record<string, unknown>,
  options?: BuildFormPayloadOptions,
  original?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {}
  const primaryKey = options?.primaryKey ?? 'id'
  const skipComponents = new Set(options?.skipComponents ?? ['CrmTreeTable'])
  const fields = await getCachedCollectionFields(collection)
  const relations = (await getCachedRelations()) as RelationDefinition[]

  for (const section of schema.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        if (field.field === primaryKey) continue
        if (skipComponents.has(field.component)) continue
        if (!isWritableLayoutField(field, draft)) continue
        if (!Object.prototype.hasOwnProperty.call(draft, field.field)) continue
        if (!(await shouldIncludeFieldInPayload(collection, field.field))) continue

        const raw = draft[field.field]
        if (
          isFieldM2O(collection, field.field, fields, relations) &&
          (raw === 0 || raw === '0')
        ) {
          continue
        }

        if (isFieldM2A(collection, field.field, fields, relations)) {
          // Existing parent: junction CRUD is owned by M2ABlocksField.
          if (original) continue
          // Create path: nest link-shaped blocks onto parent createRecord.
          const nested = await normalizeM2AFieldValue(
            collection,
            field.field,
            raw,
          )
          if (!Array.isArray(nested) || nested.length === 0) continue
          payload[field.field] = nested
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
          if (!junctionField) continue
          const nested = m2mOptionsToNestedPayload(
            raw,
            original?.[field.field],
            junctionField,
          )
          if (!nested.length) continue
          payload[field.field] = nested
          continue
        }

        if (isFilesField(field)) {
          // Image / single-file M2O: persist FK scalar on the parent record
          // (same shape as other M2O writes — never `{ id }` objects).
          if (isSingleFileField(field)) {
            const next = singleFileM2OPayload(raw)
            if (original) {
              const prev = singleFileM2OPayload(original[field.field])
              if ((next?.id ?? null) === (prev?.id ?? null)) continue
            } else if (!next) {
              continue
            }
            payload[field.field] = next?.id ?? null
            continue
          }
          // Existing parent: junction CRUD is owned by AttachedDataTableField.
          if (original) continue
          const nested = Array.isArray(raw)
            ? filesItemsToO2MPayload(raw as Array<Record<string, unknown>>)
            : []
          if (!nested.length) continue
          payload[field.field] = nested
          continue
        }

        let normalized = await normalizeEntityFormFieldValue(
          collection,
          field.field,
          raw,
          fields,
          relations,
        )

        const isM2O = isFieldM2O(collection, field.field, fields, relations)
        const clearedM2O =
          isM2O &&
          extractRelationFieldId(normalized) === null &&
          extractRelationFieldId(raw) === null

        if (original) {
          const originalNormalized = await normalizeEntityFormFieldValue(
            collection,
            field.field,
            original[field.field],
            fields,
            relations,
          )
          // Skip empty M2O on create / when already empty. Still send null when
          // clearing an existing relation so the FK is written as SET NULL.
          if (clearedM2O && extractRelationFieldId(originalNormalized) === null) {
            continue
          }
          if (formValuesEqual(normalized, originalNormalized)) continue
        } else if (clearedM2O) {
          continue
        }

        payload[field.field] = clearedM2O ? null : normalized
      }
    }
  }

  // Formula fields are form-readonly (server-owned), but still persist when the
  // draft inputs imply a different stored value — otherwise list stays stale
  // when the user only relies on live preview.
  const layoutFieldNames = new Set<string>()
  for (const section of schema.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        layoutFieldNames.add(field.field)
      }
    }
  }
  const formulas: Record<string, string> = {}
  for (const definition of fields) {
    if (!layoutFieldNames.has(definition.field)) continue
    const formula = resolveFieldFormula(
      definition,
      fields.map((item) => item.field),
    )
    if (formula) formulas[definition.field] = formula
  }
  if (Object.keys(formulas).length) {
    const calculated = applyCalculatedFields(draft, formulas)
    for (const fieldName of Object.keys(formulas)) {
      if (!Object.prototype.hasOwnProperty.call(calculated, fieldName)) continue
      const nextValue = calculated[fieldName]
      if (original && formulaValuesEqual(original[fieldName], nextValue)) {
        continue
      }
      payload[fieldName] = nextValue
    }
  }

  return payload
}

export async function buildWritableFormPayload(
  collection: string,
  schema: EntityLayoutSchema,
  draft: Record<string, unknown>,
  options?: BuildFormPayloadOptions,
): Promise<Record<string, unknown>> {
  return buildFormPayload(collection, schema, draft, options)
}

export async function buildChangedFormPayload(
  collection: string,
  schema: EntityLayoutSchema,
  draft: Record<string, unknown>,
  original: Record<string, unknown>,
  options?: BuildFormPayloadOptions,
): Promise<Record<string, unknown>> {
  return buildFormPayload(collection, schema, draft, options, original)
}
