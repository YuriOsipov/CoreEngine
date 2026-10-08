import { query } from '../db/pool.js'

/**
 * Serve user labels/pickers from Supabase `app_users`.
 * Returns `id = backend_user_id` so record `user_created` / `user_updated`
 * values keep resolving to names.
 */
export async function postgresListUsers(options: {
  ids?: string[] | null
  search?: string | null
  fields?: string[] | null
  limit?: number | null
  sort?: string[] | null
}): Promise<Record<string, unknown>[]> {
  const ids = (options.ids ?? []).map(String).filter(Boolean)
  const searchText = options.search?.trim() || ''

  // Don't dump all users unless ids/search/limit is provided.
  if (ids.length === 0 && !searchText && options.limit == null) return []

  const where: string[] = ['backend_user_id IS NOT NULL']
  const params: unknown[] = []
  let next = 1

  if (ids.length > 0) {
    where.push(
      `(backend_user_id = ANY($${next}::text[]) OR id::text = ANY($${next}::text[]))`,
    )
    params.push(ids)
    next += 1
  }
  if (searchText) {
    where.push(
      `(first_name ILIKE $${next} OR last_name ILIKE $${next} OR email ILIKE $${next})`,
    )
    params.push(`%${searchText}%`)
    next += 1
  }

  const limit = options.limit ?? (ids.length > 0 ? ids.length : 20)
  params.push(limit)
  const limitSql = `$${next}`

  const rows = await query<{
    id: string
    first_name: string | null
    last_name: string | null
    email: string | null
  }>(
    `SELECT COALESCE(NULLIF(backend_user_id, ''), id::text) AS id,
            first_name, last_name, email
     FROM public.app_users
     WHERE ${where.join(' AND ')}
     ORDER BY first_name NULLS LAST, last_name NULLS LAST
     LIMIT ${limitSql}`,
    params,
  )

  // Prefer matching the requested id when both app id and backend_user_id exist.
  if (ids.length === 0) return rows
  const byRequested = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    byRequested.set(String(row.id), row)
  }
  // Also index by raw lookup so stamps that used app_users.id still resolve.
  const extras = await query<{
    match_id: string
    id: string
    first_name: string | null
    last_name: string | null
    email: string | null
  }>(
    `SELECT id::text AS match_id,
            COALESCE(NULLIF(backend_user_id, ''), id::text) AS id,
            first_name, last_name, email
     FROM public.app_users
     WHERE id::text = ANY($1::text[])
        OR backend_user_id = ANY($1::text[])`,
    [ids],
  )
  for (const row of extras) {
    const payload = {
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
    }
    byRequested.set(row.match_id, payload)
    byRequested.set(row.id, payload)
  }
  return ids
    .map((id) => byRequested.get(id))
    .filter((row): row is Record<string, unknown> => Boolean(row))
}

export interface PostgresMeUser {
  id: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  adminAccess: boolean
  roleId: string | null
  roleName: string | null
  roleAdminAccess: boolean
}

/** Current user from `app_users` keyed by `backend_user_id`. */
export async function postgresFetchMe(backendUserId: string): Promise<PostgresMeUser | null> {
  const rows = await query<{
    id: string | null
    first_name: string | null
    last_name: string | null
    email: string | null
    role_id: string | null
    role_name: string | null
    is_admin: boolean | null
  }>(
    `SELECT u.backend_user_id AS id,
            u.first_name,
            u.last_name,
            u.email,
            r.backend_role_id AS role_id,
            r.name AS role_name,
            COALESCE(r.is_admin, false) AS is_admin
     FROM public.app_users u
     LEFT JOIN public.app_roles r ON r.id = u.role_id
     WHERE u.backend_user_id = $1
       AND u.is_active = true
     LIMIT 1`,
    [backendUserId],
  )
  const row = rows[0]
  if (!row) return null
  const isAdmin = row.is_admin === true
  return {
    id: row.id,
    firstName: row.first_name?.trim() || null,
    lastName: row.last_name?.trim() || null,
    email: row.email?.trim() || null,
    adminAccess: isAdmin,
    roleId: row.role_id,
    roleName: row.role_name?.trim() || null,
    roleAdminAccess: isAdmin,
  }
}

/**
 * Resolve `me` for opaque static service tokens when legacy HTTP runtime is off.
 * Prefer `AUTH_STATIC_USER_ID` (backend_user_id), else first admin, else first active user.
 */
export async function postgresFetchStaticMe(): Promise<PostgresMeUser | null> {
  const forced = (process.env.AUTH_STATIC_USER_ID || '').trim()
  if (forced) return postgresFetchMe(forced)

  const rows = await query<{
    id: string | null
    first_name: string | null
    last_name: string | null
    email: string | null
    role_id: string | null
    role_name: string | null
    is_admin: boolean | null
  }>(
    `SELECT u.backend_user_id AS id,
            u.first_name,
            u.last_name,
            u.email,
            r.backend_role_id AS role_id,
            r.name AS role_name,
            COALESCE(r.is_admin, false) AS is_admin
     FROM public.app_users u
     LEFT JOIN public.app_roles r ON r.id = u.role_id
     WHERE u.is_active = true
       AND u.backend_user_id IS NOT NULL
     ORDER BY COALESCE(r.is_admin, false) DESC, u.email NULLS LAST
     LIMIT 1`,
  )
  const row = rows[0]
  if (!row) return null
  const isAdmin = row.is_admin === true
  return {
    id: row.id,
    firstName: row.first_name?.trim() || null,
    lastName: row.last_name?.trim() || null,
    email: row.email?.trim() || null,
    adminAccess: isAdmin,
    roleId: row.role_id,
    roleName: row.role_name?.trim() || null,
    roleAdminAccess: isAdmin,
  }
}

/** True once any users have been imported into app_users. */
export async function hasAppUsers(): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM public.app_users WHERE backend_user_id IS NOT NULL
     ) AS exists`,
  )
  return Boolean(rows[0]?.exists)
}
