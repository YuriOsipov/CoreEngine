/**
 * Fill missing keys on create from registry field `options.default`.
 * Promoted-column inserts bind every column; without this, absent booleans
 * become explicit NULL and UI defaults never stick.
 */
import { loadEntityFieldMeta } from './fieldMeta.js'

const SKIP_DEFAULT_FIELDS = new Set([
  'id',
  'name',
  'user_created',
  'user_updated',
  'owner_id',
  'date_created',
  'date_updated',
  'is_deleted',
])

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key)
}

export async function applyFieldDefaultsOnCreate(
  entityApiName: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await loadEntityFieldMeta(entityApiName)
  let next: Record<string, unknown> | null = null

  for (const field of fields) {
    if (SKIP_DEFAULT_FIELDS.has(field.apiName)) continue
    if (hasOwn(data, field.apiName) || (next && hasOwn(next, field.apiName))) {
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(field.options, 'default')) continue
    const value = field.options.default
    if (value === undefined) continue
    if (!next) next = { ...data }
    next[field.apiName] = value
  }

  return next ?? data
}
