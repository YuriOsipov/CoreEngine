import type { EntityLayoutSchema, LayoutFieldMetadata, FieldDefinition } from '@/interfaces'
import { isEditableFormLayoutField } from '@/core/layoutFieldRules'
import { getCachedCollectionFields } from '@/modules/entities/services/collectionSchema'

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
