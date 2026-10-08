import { query } from '../../db/pool.js'

const canonicalCache = new Map<string, string>()

export function clearCanonicalEntityNameCache(): void {
  canonicalCache.clear()
}

/** Registry `api_name` for an entity, ignoring caller casing (`Item` → `item`). */
export async function resolveCanonicalEntityApiName(
  entityApiName: string,
): Promise<string> {
  const key = entityApiName.trim()
  if (!key) return entityApiName
  const cacheKey = key.toLowerCase()
  const cached = canonicalCache.get(cacheKey)
  if (cached) return cached

  const rows = await query<{ api_name: string }>(
    `SELECT api_name
     FROM public.entities
     WHERE deleted_at IS NULL AND lower(api_name) = lower($1)
     LIMIT 1`,
    [key],
  )
  const name = rows[0]?.api_name ?? key
  canonicalCache.set(cacheKey, name)
  setTimeout(() => canonicalCache.delete(cacheKey), 30_000)
  return name
}
