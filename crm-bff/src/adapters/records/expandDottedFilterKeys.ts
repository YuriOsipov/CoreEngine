/**
 * Expand flat SOQL-style keys (`account.margin`) into nested filter objects
 * (`{ account: { margin: … } }`) so Hasura/Directus compilers (which reject
 * dots in GraphQL field names) match Supabase EXISTS behavior.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const LOGICAL_OPS = new Set(['_and', '_or', '_not', '_some', '_none'])

/** Comparison ops only (`_eq`, `_gt`, …) — not logical wrappers that nest filters. */
function isComparisonObject(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value)
  if (!keys.length) return false
  return keys.every((key) => key.startsWith('_') && !LOGICAL_OPS.has(key))
}

function deepMergeFilter(left: unknown, right: unknown): unknown {
  if (!isPlainObject(left)) return right
  if (!isPlainObject(right)) return right
  const out: Record<string, unknown> = { ...left }
  for (const [key, value] of Object.entries(right)) {
    out[key] = key in out ? deepMergeFilter(out[key], value) : value
  }
  return out
}

export function expandDottedFilterKeys(filter: unknown): unknown {
  if (Array.isArray(filter)) {
    return filter.map((item) => expandDottedFilterKeys(item))
  }
  if (!isPlainObject(filter) || isComparisonObject(filter)) return filter

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filter)) {
    if (key === '_and' || key === '_or') {
      out[key] = Array.isArray(value)
        ? value.map((child) => expandDottedFilterKeys(child))
        : value
      continue
    }
    if (key === '_not' || key === '_some' || key === '_none') {
      out[key] = expandDottedFilterKeys(value)
      continue
    }
    if (key.includes('.')) {
      const segments = key
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean)
      if (segments.length < 2) continue
      let node: unknown = isComparisonObject(value)
        ? value
        : expandDottedFilterKeys(value)
      for (let index = segments.length - 1; index >= 1; index -= 1) {
        node = { [segments[index]!]: node }
      }
      const root = segments[0]!
      out[root] = deepMergeFilter(out[root], node)
      continue
    }
    out[key] = isComparisonObject(value) ? value : expandDottedFilterKeys(value)
  }
  return out
}
