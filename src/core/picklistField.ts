import type { FieldDefinition } from '@/interfaces'
import { normalizeFieldInterface } from '@/core/graphql/schemaMapper'

/** True when field options enable multi-select picklist. */
export function isMultiPicklistOptions(
  options: Record<string, unknown> | null | undefined,
): boolean {
  if (!options || typeof options !== 'object') return false
  return options.multiple === true
}

/** Registry field: picklist interface with Allow multiple. */
export function isMultiPicklistFieldDefinition(
  field: Pick<FieldDefinition, 'meta'> | null | undefined,
): boolean {
  if (!field?.meta) return false
  const iface = normalizeFieldInterface(field.meta.interface || '')
  if (iface !== 'select-dropdown') return false
  return isMultiPicklistOptions(
    field.meta.options as Record<string, unknown> | null | undefined,
  )
}

/**
 * Coerce stored picklist values into a string[]/number[] for MultiSelect.
 * Accepts arrays, JSON array strings, comma-separated strings, or a scalar.
 */
export function normalizeMultiPicklistValue(value: unknown): unknown[] {
  if (value === null || value === undefined || value === '') return []

  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined && item !== '')
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) {
          return normalizeMultiPicklistValue(parsed)
        }
      } catch {
        /* fall through */
      }
    }
    if (trimmed.includes(',')) {
      return trimmed
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    }
    return [trimmed]
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [value]
  }

  return []
}
