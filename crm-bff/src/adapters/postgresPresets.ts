import { query } from '../db/pool.js'

/**
 * Serve presets (bookmark/saved views) from Supabase `app_presets`.
 * Returns `id = backend_preset_id` for client id parity.
 * Supports the filter shapes the app actually uses: `_nnull`/`_null`/`_eq`
 * on `collection` / `bookmark` / `id`.
 */
const FILTERABLE = new Set(['id', 'collection', 'bookmark'])

function column(field: string): string {
  return field === 'id' ? 'backend_preset_id' : field
}

function compilePresetFilter(
  filter: Record<string, unknown> | null | undefined,
  params: unknown[],
): string {
  if (!filter || typeof filter !== 'object') return ''
  const clauses: string[] = []
  for (const [key, raw] of Object.entries(filter)) {
    if (!FILTERABLE.has(key)) continue
    const col = column(key)
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const ops = raw as Record<string, unknown>
      if (ops._nnull === true || ops._null === false) clauses.push(`${col} IS NOT NULL`)
      else if (ops._null === true || ops._nnull === false) clauses.push(`${col} IS NULL`)
      else if ('_eq' in ops) {
        params.push(String(ops._eq))
        clauses.push(`${col} = $${params.length}`)
      }
    } else if (raw != null) {
      params.push(String(raw))
      clauses.push(`${col} = $${params.length}`)
    }
  }
  return clauses.join(' AND ')
}

function compilePresetSort(sort?: string[] | null): string {
  const cols: string[] = []
  for (const entry of sort ?? []) {
    const desc = entry.startsWith('-')
    const field = desc ? entry.slice(1) : entry
    if (!FILTERABLE.has(field)) continue
    cols.push(`${column(field)} ${desc ? 'DESC' : 'ASC'} NULLS LAST`)
  }
  return cols.length ? cols.join(', ') : 'collection ASC NULLS LAST, bookmark ASC NULLS LAST'
}

export async function postgresListPresets(options: {
  fields?: string[] | null
  filter?: Record<string, unknown> | null
  sort?: string[] | null
  limit?: number
}): Promise<Record<string, unknown>[]> {
  const params: unknown[] = []
  const whereSql = compilePresetFilter(options.filter, params)
  const orderSql = compilePresetSort(options.sort)

  let limitSql = ''
  const limit = options.limit ?? -1
  if (limit >= 0) {
    params.push(limit)
    limitSql = ` LIMIT $${params.length}`
  }

  const rows = await query<Record<string, unknown>>(
    `SELECT backend_preset_id AS id, collection, bookmark, filter, search,
            search_query, layout_query, user_id AS user, role_id AS role
     FROM public.app_presets
     ${whereSql ? `WHERE ${whereSql}` : ''}
     ORDER BY ${orderSql}${limitSql}`,
    params,
  )
  return rows
}

/** True once any presets have been imported. */
export async function hasAppPresets(): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM public.app_presets) AS exists`,
  )
  return Boolean(rows[0]?.exists)
}
