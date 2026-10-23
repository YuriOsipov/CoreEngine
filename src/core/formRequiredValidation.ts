/**
 * Shared required-field checks for entity forms (create / edit dialogs).
 * Registry `required` is UI metadata; dialogs must validate before save.
 */

export function isBlankFormValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'boolean') return false
  if (typeof value === 'number') return Number.isNaN(value)
  if (typeof value === 'string') return value.trim() === ''
  if (value instanceof Date) return Number.isNaN(value.getTime())
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('value' in record) {
      const inner = record.value
      if (inner === null || inner === undefined) return true
      if (typeof inner === 'string' && inner.trim() === '') return true
      if (inner instanceof Date) return Number.isNaN(inner.getTime())
    }
    if ('id' in record) {
      const id = record.id
      if (id === null || id === undefined) return true
      if (typeof id === 'string' && id.trim() === '') return true
    }
  }
  return false
}

export interface FormRequiredValidationResult {
  valid: boolean
  missingLabels: string[]
}
