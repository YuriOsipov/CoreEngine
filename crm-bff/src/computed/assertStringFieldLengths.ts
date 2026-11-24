/**
 * Enforce registry maxLength on STRING / TEXT writes.
 * Legacy fields without options.maxLength remain unrestricted.
 */
import { resolveStringFieldMaxLength } from '../schema/crmStorage.js'
import { loadEntityFieldMeta } from './fieldMeta.js'

export function assertValueWithinMaxLength(
  fieldApiName: string,
  value: unknown,
  maxLength: number,
): void {
  if (value == null) return
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : null
  if (text == null) return
  if (text.length <= maxLength) return
  throw new Error(
    `Field "${fieldApiName}" exceeds maximum length of ${maxLength} characters (got ${text.length})`,
  )
}

export async function assertStringFieldLengths(
  entityApiName: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const fields = await loadEntityFieldMeta(entityApiName)
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(patch, field.apiName)) continue
    const maxLength = resolveStringFieldMaxLength(field.fieldType, field.options)
    if (maxLength == null) continue
    assertValueWithinMaxLength(field.apiName, patch[field.apiName], maxLength)
  }
}
