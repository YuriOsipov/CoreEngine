import { query } from '../db/pool.js'

export interface AppRoleOption {
  id: string
  name: string
}

/**
 * Registry `app_roles` only. Expose `backend_role_id` as `id` so role-scoped
 * layout rows keep matching imported role UUIDs.
 */
export async function listRoles(): Promise<AppRoleOption[]> {
  const rows = await query<{
    name: string
    backend_role_id: string | null
    id: string
  }>(
    `SELECT
       id::text AS id,
       name,
       backend_role_id
     FROM public.app_roles
     WHERE backend_role_id IS NOT NULL
     ORDER BY name ASC`,
  )

  return rows.map((row) => ({
    id: row.backend_role_id || row.id,
    name: row.name,
  }))
}
