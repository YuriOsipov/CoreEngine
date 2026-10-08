import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'

/** Serve dashboards from Supabase `app_dashboards` (id = backend id). */
export async function postgresListDashboards(options: {
  fields?: string[] | null
  sort?: string[] | null
  limit?: number
}): Promise<Record<string, unknown>[]> {
  const orderSql = compileSort(options.sort, ['name'], DASHBOARD_COLUMNS)
  const params: unknown[] = []
  let limitSql = ''
  const limit = options.limit ?? -1
  if (limit >= 0) {
    params.push(limit)
    limitSql = ` LIMIT $${params.length}`
  }
  return query<Record<string, unknown>>(
    `SELECT backend_dashboard_id AS id, name, icon, note, color
     FROM public.app_dashboards
     ORDER BY ${orderSql}${limitSql}`,
    params,
  )
}

export type DashboardUpsertInput = {
  id?: string | null
  name: string
  icon?: string | null
  note?: string | null
  color?: string | null
}

export type PanelUpsertInput = {
  id?: string | null
  dashboard: string
  name?: string | null
  icon?: string | null
  color?: string | null
  show_header?: boolean | null
  note?: string | null
  type: string
  position_x?: number | null
  position_y?: number | null
  width?: number | null
  height?: number | null
  options?: Record<string, unknown> | null
}

/** Upsert dashboard by `backend_dashboard_id` (public id). */
export async function postgresUpsertDashboard(
  input: DashboardUpsertInput,
): Promise<Record<string, unknown>> {
  const backendId = (input.id && String(input.id).trim()) || randomUUID()
  const rows = await query<Record<string, unknown>>(
    `INSERT INTO public.app_dashboards (
       backend_dashboard_id, name, icon, note, color
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (backend_dashboard_id) DO UPDATE SET
       name = EXCLUDED.name,
       icon = EXCLUDED.icon,
       note = EXCLUDED.note,
       color = EXCLUDED.color,
       updated_at = now()
     RETURNING backend_dashboard_id AS id, name, icon, note, color`,
    [
      backendId,
      input.name,
      input.icon ?? null,
      input.note ?? null,
      input.color ?? null,
    ],
  )
  if (!rows[0]) throw new Error('postgresUpsertDashboard: no row returned')
  return rows[0]
}

/** Delete dashboard and cascade panels that reference its public id. */
export async function postgresDeleteDashboard(id: string): Promise<boolean> {
  const backendId = String(id)
  await query(`DELETE FROM public.app_panels WHERE dashboard_id = $1`, [backendId])
  const rows = await query<{ id: string }>(
    `DELETE FROM public.app_dashboards
     WHERE backend_dashboard_id = $1
     RETURNING backend_dashboard_id AS id`,
    [backendId],
  )
  return rows.length > 0
}

/** Upsert panel by `backend_panel_id` (public id). */
export async function postgresUpsertPanel(
  input: PanelUpsertInput,
): Promise<Record<string, unknown>> {
  const backendId = (input.id && String(input.id).trim()) || randomUUID()
  const rows = await query<Record<string, unknown>>(
    `INSERT INTO public.app_panels (
       backend_panel_id, dashboard_id, name, icon, color, show_header, note,
       type, position_x, position_y, width, height, options
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::jsonb, '{}'::jsonb)
     )
     ON CONFLICT (backend_panel_id) DO UPDATE SET
       dashboard_id = EXCLUDED.dashboard_id,
       name = EXCLUDED.name,
       icon = EXCLUDED.icon,
       color = EXCLUDED.color,
       show_header = EXCLUDED.show_header,
       note = EXCLUDED.note,
       type = EXCLUDED.type,
       position_x = EXCLUDED.position_x,
       position_y = EXCLUDED.position_y,
       width = EXCLUDED.width,
       height = EXCLUDED.height,
       options = EXCLUDED.options,
       updated_at = now()
     RETURNING backend_panel_id AS id, dashboard_id AS dashboard, name, icon, color,
               show_header, note, type, position_x, position_y, width, height, options`,
    [
      backendId,
      String(input.dashboard),
      input.name ?? null,
      input.icon ?? null,
      input.color ?? null,
      input.show_header ?? true,
      input.note ?? null,
      input.type,
      input.position_x ?? 1,
      input.position_y ?? 1,
      input.width ?? 10,
      input.height ?? 8,
      JSON.stringify(input.options ?? {}),
    ],
  )
  if (!rows[0]) throw new Error('postgresUpsertPanel: no row returned')
  return rows[0]
}

/** Delete a single panel by public id. */
export async function postgresDeletePanel(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM public.app_panels
     WHERE backend_panel_id = $1
     RETURNING backend_panel_id AS id`,
    [String(id)],
  )
  return rows.length > 0
}

/** Serve panels from Supabase `app_panels` (id = backend id, dashboard = fk). */
export async function postgresListPanels(options: {
  fields?: string[] | null
  filter?: Record<string, unknown> | null
  sort?: string[] | null
  limit?: number
}): Promise<Record<string, unknown>[]> {
  const params: unknown[] = []
  const whereSql = compilePanelFilter(options.filter, params)
  const orderSql = compileSort(
    options.sort,
    ['dashboard', 'position_y', 'position_x'],
    PANEL_COLUMNS,
  )
  let limitSql = ''
  const limit = options.limit ?? -1
  if (limit >= 0) {
    params.push(limit)
    limitSql = ` LIMIT $${params.length}`
  }
  return query<Record<string, unknown>>(
    `SELECT backend_panel_id AS id, dashboard_id AS dashboard, name, icon, color,
            show_header, note, type, position_x, position_y, width, height, options
     FROM public.app_panels
     ${whereSql ? `WHERE ${whereSql}` : ''}
     ORDER BY ${orderSql}${limitSql}`,
    params,
  )
}

export async function hasAppDashboards(): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM public.app_dashboards) AS exists`,
  )
  return Boolean(rows[0]?.exists)
}

// Map API field names -> real columns for sort/filter.
const DASHBOARD_COLUMNS: Record<string, string> = {
  id: 'backend_dashboard_id',
  name: 'name',
  icon: 'icon',
  note: 'note',
  color: 'color',
}
const PANEL_COLUMNS: Record<string, string> = {
  id: 'backend_panel_id',
  dashboard: 'dashboard_id',
  name: 'name',
  type: 'type',
  position_x: 'position_x',
  position_y: 'position_y',
  width: 'width',
  height: 'height',
}

function compileSort(
  sort: string[] | null | undefined,
  fallback: string[],
  columns: Record<string, string>,
): string {
  const list = sort?.length ? sort : fallback
  const clauses: string[] = []
  for (const entry of list) {
    const desc = entry.startsWith('-')
    const field = desc ? entry.slice(1) : entry
    const col = columns[field]
    if (!col) continue
    clauses.push(`${col} ${desc ? 'DESC' : 'ASC'} NULLS LAST`)
  }
  return clauses.length ? clauses.join(', ') : 'updated_at DESC'
}

/** Supports `dashboard`/`id` with `_eq`/`_in` — the shapes panels use. */
function compilePanelFilter(
  filter: Record<string, unknown> | null | undefined,
  params: unknown[],
): string {
  if (!filter || typeof filter !== 'object') return ''
  const clauses: string[] = []
  for (const [key, raw] of Object.entries(filter)) {
    const col = PANEL_COLUMNS[key]
    if (!col) continue
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const ops = raw as Record<string, unknown>
      if ('_eq' in ops) {
        params.push(String(ops._eq))
        clauses.push(`${col} = $${params.length}`)
      } else if (Array.isArray(ops._in)) {
        params.push((ops._in as unknown[]).map(String))
        clauses.push(`${col} = ANY($${params.length}::text[])`)
      }
    } else if (raw != null) {
      params.push(String(raw))
      clauses.push(`${col} = $${params.length}`)
    }
  }
  return clauses.join(' AND ')
}
