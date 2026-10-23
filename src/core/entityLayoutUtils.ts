import type {
  EntityLayoutSchema,
  LayoutFieldMetadata,
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import { isEditableFormLayoutField } from '@/core/layoutFieldRules'
import {
  getCachedCollectionFields,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import { bridgeReadItem } from '@/core/graphql/itemsBridge'
import {
  keysEqual,
  relationField,
  relationManyCollection,
  relationRelatedCollection,
} from '@/core/relationHelpers'

export function createLayoutSchema(schema: EntityLayoutSchema): EntityLayoutSchema {
  return {
    ...schema,
    sections: schema.sections.map((section) => ({
      ...section,
      groups: section.groups
        .map((group) => ({
          ...group,
          fields: group.fields.filter(isCreateDialogField),
        }))
        .filter((group) => group.fields.length > 0),
    })),
  }
}

const CREATE_DIALOG_EXCLUDED_COMPONENTS = new Set([
  'DataTable',
  'Files',
  'CrmTreeTable',
  'CrmScheduler',
  'CrmActivityLog',
  'CrmDocEngine',
  'M2ABuilder',
])

export function isCreateDialogField(field: LayoutFieldMetadata): boolean {
  return (
    !CREATE_DIALOG_EXCLUDED_COMPONENTS.has(field.component) &&
    isEditableFormLayoutField(field)
  )
}

export async function buildDefaultDraft(
  schema: EntityLayoutSchema,
  collection: string,
): Promise<Record<string, unknown>> {
  const definitions = await getCachedCollectionFields(collection)
  const fieldDefinitions = new Map(
    (definitions as FieldDefinition[]).map((field) => [field.field, field]),
  )
  const defaults: Record<string, unknown> = {}

  for (const field of layoutFields(schema)) {
    if (field.field === 'id') continue

    const definition = fieldDefinitions.get(field.field)
    const defaultValue = fieldDefaultValue(field, definition)
    if (defaultValue !== undefined) {
      defaults[field.field] = defaultValue
    }
  }

  return defaults
}

export function layoutFields(schema: EntityLayoutSchema): LayoutFieldMetadata[] {
  return schema.sections.reduce<LayoutFieldMetadata[]>(
    (fields, section) => [
      ...fields,
      ...section.groups.reduce<LayoutFieldMetadata[]>(
        (groupFields, group) => [...groupFields, ...group.fields],
        [],
      ),
    ],
    [],
  )
}

export function fieldDefaultValue(
  field: LayoutFieldMetadata,
  definition?: FieldDefinition,
): unknown {
  const value =
    definition?.schema?.default_value ??
    definition?.schema?.defaultValue ??
    definition?.meta?.options?.default ??
    definition?.meta?.options?.defaultValue

  if (value === undefined || value === null) return undefined

  return normalizeDefaultValue(field, value)
}

export function normalizeDefaultValue(
  field: LayoutFieldMetadata,
  value: unknown,
): unknown {
  if (field.component === 'Checkbox' || field.component === 'ToggleSwitch') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') {
      return ['true', '1', 'yes', 'on'].includes(value.toLowerCase())
    }
  }

  if (field.component === 'InputNumber' && typeof value === 'string') {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue : null
  }

  if (Array.isArray(value) || typeof value === 'object') {
    return structuredClone(value)
  }

  return value
}

function isEmptyDraftValue(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function readDefaultFromParentOption(definition: FieldDefinition): string {
  const options = definition.meta?.options
  if (!options || typeof options !== 'object') return ''
  const raw = (options as Record<string, unknown>).defaultFromParent
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * `item.base_price` → copy from M2O `item` when selected.
 * Legacy bare `base_price` → copy from the related-list parent record.
 */
export function parseDefaultFromParentSource(source: string): {
  relationField: string | null
  field: string
} {
  const trimmed = source.trim()
  if (!trimmed) return { relationField: null, field: '' }
  const dot = trimmed.indexOf('.')
  if (dot <= 0) return { relationField: null, field: trimmed }
  return {
    relationField: trimmed.slice(0, dot).trim(),
    field: trimmed.slice(dot + 1).trim(),
  }
}

/**
 * Upgrade legacy bare `defaultFromParent` values (e.g. `base_price`) to
 * `item.base_price` when exactly one child M2O related entity owns that field.
 * In-memory only — does not write the registry.
 */
export async function resolveDefaultFromParentDefinitions(
  childCollection: string,
  definitions: FieldDefinition[],
): Promise<FieldDefinition[]> {
  const bareIndexes: number[] = []
  definitions.forEach((definition, index) => {
    const source = readDefaultFromParentOption(definition)
    if (source && !source.includes('.')) bareIndexes.push(index)
  })
  if (bareIndexes.length === 0) return definitions

  const relations = (await getCachedRelations()) as RelationDefinition[]
  const m2oParents = relations.filter(
    (relation) =>
      keysEqual(relationManyCollection(relation), childCollection) &&
      Boolean(relationRelatedCollection(relation)) &&
      Boolean(relationField(relation)),
  )
  if (m2oParents.length === 0) return definitions

  const relatedFieldSets = await Promise.all(
    m2oParents.map(async (relation) => {
      const related = relationRelatedCollection(relation)
      const fields = await getCachedCollectionFields(related)
      return {
        relationField: relationField(relation),
        fields: new Set(fields.map((field) => field.field)),
      }
    }),
  )

  return definitions.map((definition, index) => {
    if (!bareIndexes.includes(index)) return definition
    const source = readDefaultFromParentOption(definition)
    const matches = relatedFieldSets.filter((entry) =>
      [...entry.fields].some((field) => keysEqual(field, source)),
    )
    if (matches.length !== 1) return definition
    const resolved = `${matches[0].relationField}.${source}`
    const options = {
      ...((definition.meta?.options ?? {}) as Record<string, unknown>),
      defaultFromParent: resolved,
    }
    return {
      ...definition,
      meta: {
        ...(definition.meta ?? {}),
        options,
      },
    }
  })
}

/**
 * Ambient related-list parent field names to fetch for create-time defaults.
 * Paths like `item.base_price` are applied when that M2O is selected, not here.
 */
export function collectDefaultFromParentSources(
  definitions: FieldDefinition[],
  ambientParentField?: string,
): string[] {
  const sources = new Set<string>()
  const ambient = ambientParentField?.trim() || ''
  for (const definition of definitions) {
    const source = readDefaultFromParentOption(definition)
    if (!source) continue
    const parsed = parseDefaultFromParentSource(source)
    if (!parsed.field) continue
    if (parsed.relationField) {
      if (ambient && keysEqual(parsed.relationField, ambient)) {
        sources.add(parsed.field)
      }
      continue
    }
    sources.add(parsed.field)
  }
  return [...sources]
}

/**
 * Target←source pairs for `defaultFromParent` paths pinned to a given M2O field
 * (e.g. selecting Item applies `item.base_price` → `base_price`).
 */
export function defaultFromParentTargetsForRelation(
  definitions: FieldDefinition[],
  relationField: string,
): Array<{ targetField: string; sourceField: string }> {
  const relation = relationField.trim()
  if (!relation) return []
  const result: Array<{ targetField: string; sourceField: string }> = []
  for (const definition of definitions) {
    const source = readDefaultFromParentOption(definition)
    if (!source || !definition.field) continue
    const parsed = parseDefaultFromParentSource(source)
    if (!parsed.relationField || !parsed.field) continue
    if (!keysEqual(parsed.relationField, relation)) continue
    result.push({ targetField: definition.field, sourceField: parsed.field })
  }
  return result
}

/**
 * Ensure create-time parent context includes fields needed for defaultFromParent.
 * Related-list parentRecord often omits Highlight-only fields; fetch those on create.
 */
export async function enrichParentRecordForFieldDefaults(
  parentRecord: Record<string, unknown> | null | undefined,
  options: {
    parentCollection?: string
    parentId?: string | number | null
    sourceFields: string[]
  },
): Promise<Record<string, unknown> | null | undefined> {
  const sourceFields = options.sourceFields
    .map((field) => field.trim())
    .filter(Boolean)
  if (sourceFields.length === 0) return parentRecord

  const base: Record<string, unknown> = parentRecord ? { ...parentRecord } : {}
  const missing = sourceFields.filter((field) => isEmptyDraftValue(base[field]))
  if (missing.length === 0) return base

  const collection = options.parentCollection?.trim()
  const parentId = options.parentId
  if (
    !collection ||
    parentId === undefined ||
    parentId === null ||
    parentId === ''
  ) {
    return Object.keys(base).length > 0 ? base : parentRecord
  }

  try {
    const fetched = await bridgeReadItem(collection, parentId, {
      fields: ['id', ...missing],
    })
    const next = { ...base }
    for (const field of missing) {
      if (!isEmptyDraftValue(fetched[field])) {
        next[field] = fetched[field]
      }
    }
    return next
  } catch {
    return Object.keys(base).length > 0 ? base : parentRecord
  }
}

/**
 * Copy field-registry `options.defaultFromParent` values from the related-list
 * parent record into a create draft when the target field is still empty.
 * Create-only — do not call from edit dialogs.
 * Paths like `item.base_price` are skipped here (applied when Item is selected).
 */
export function applyParentFieldDefaults(
  definitions: FieldDefinition[],
  parentRecord: Record<string, unknown> | null | undefined,
  draft: Record<string, unknown>,
  schema?: EntityLayoutSchema | null,
  ambientParentField?: string,
): Record<string, unknown> {
  if (!parentRecord) return draft

  const layoutByField = new Map(
    (schema ? layoutFields(schema) : []).map((field) => [field.field, field]),
  )
  const ambient = ambientParentField?.trim() || ''
  const next = { ...draft }
  for (const definition of definitions) {
    const source = readDefaultFromParentOption(definition)
    if (!source || !definition.field) continue
    if (!isEmptyDraftValue(next[definition.field])) continue

    const parsed = parseDefaultFromParentSource(source)
    if (!parsed.field) continue
    if (parsed.relationField) {
      if (!ambient || !keysEqual(parsed.relationField, ambient)) continue
    }

    const raw = parentRecord[parsed.field]
    if (raw === undefined || raw === null) continue
    const layoutField =
      layoutByField.get(definition.field) ??
      ({
        id: definition.field,
        field: definition.field,
        label: definition.field,
        component: 'InputText',
      } satisfies LayoutFieldMetadata)
    next[definition.field] = normalizeDefaultValue(layoutField, raw)
  }
  return next
}
