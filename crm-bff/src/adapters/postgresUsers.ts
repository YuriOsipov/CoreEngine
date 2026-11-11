import { query } from '../db/pool.js'

/** Columns the public users list may ever return (never credentials / hashes). */
const USER_LIST_FIELD_MAP: Record<string, 'id' | 'first_name' | 'last_name' | 'email'> = {
  id: 'id',
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  firstName: 'first_name',
  lastName: 'last_name',
}

const DEFAULT_USER_LIST_FIELDS = ['id', 'first_name', 'last_name'] as const
const MAX_USER_LIST_LIMIT = 200

type UserListRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
}

function resolveListLimit(
  requested: number | null | undefined,
  idsLength: number,
): number {
  const fallback = idsLength > 0 ? idsLength : 20
  const raw =
    requested == null || !Number.isFinite(Number(requested))
      ? fallback
      : Math.trunc(Number(requested))
  if (raw < 0) return MAX_USER_LIST_LIMIT
  return Math.min(Math.max(raw, 0), MAX_USER_LIST_LIMIT)
}

/** Escape `%`, `_`, and `\` so user search cannot broaden ILIKE patterns. */
export function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/** Project only allowlisted keys — client `fields` never touch SQL. */
function projectUserRow(
  row: UserListRow,
  fields: string[] | null | undefined,
  includeEmail: boolean,
): Record<string, unknown> {
  const requested =
    fields?.map((field) => String(field || '').trim()).filter(Boolean) ?? []
  const keys = requested.length ? requested : [...DEFAULT_USER_LIST_FIELDS]
  const out: Record<string, unknown> = {}
  let sawId = false
  for (const key of keys) {
    const column = USER_LIST_FIELD_MAP[key]
    if (!column) continue
    if (column === 'email' && !includeEmail) continue
    if (column === 'id') {
      out[key] = row.id
      sawId = true
    } else {
      out[key] = row[column]
    }
  }
  if (!sawId) out.id = row.id
  return out
}

/**
 * Serve user labels/pickers from Supabase `app_users`.
 * Returns `id = backend_user_id` so record `user_created` / `user_updated`
 * values keep resolving to names.
 *
 * SQL always selects a fixed safe column set from `app_users` only — never
 * `app_user_credentials` / password hashes. Client `fields` / `sort` are not
 * interpolated into SQL (`fields` is post-query allowlist projection; `sort`
 * is ignored). Emails are omitted unless `includeEmail` (admins).
 */
export async function postgresListUsers(options: {
  ids?: string[] | null
  search?: string | null
  fields?: string[] | null
  limit?: number | null
  sort?: string[] | null
  /** When false (default), email is never projected even if requested in fields. */
  includeEmail?: boolean
}): Promise<Record<string, unknown>[]> {
  const ids = (options.ids ?? []).map(String).filter(Boolean)
  const searchText = options.search?.trim() || ''
  const includeEmail = options.includeEmail === true

  // Don't dump all users unless ids/search/limit is provided.
  if (ids.length === 0 && !searchText && options.limit == null) return []

  const where: string[] = ['backend_user_id IS NOT NULL', 'is_active = true']
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
      `(first_name ILIKE $${next} ESCAPE '\\' OR last_name ILIKE $${next} ESCAPE '\\' OR email ILIKE $${next} ESCAPE '\\')`,
    )
    params.push(`%${escapeIlikePattern(searchText)}%`)
    next += 1
  }

  const limit = resolveListLimit(options.limit, ids.length)
  params.push(limit)
  const limitSql = `$${next}`

  const rows = await query<UserListRow>(
    `SELECT COALESCE(NULLIF(backend_user_id, ''), id::text) AS id,
            first_name, last_name, email
     FROM public.app_users
     WHERE ${where.join(' AND ')}
     ORDER BY first_name NULLS LAST, last_name NULLS LAST
     LIMIT ${limitSql}`,
    params,
  )

  const project = (row: UserListRow) =>
    projectUserRow(row, options.fields, includeEmail)

  // Prefer matching the requested id when both app id and backend_user_id exist.
  if (ids.length === 0) return rows.map(project)

  const byRequested = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    byRequested.set(String(row.id), project(row))
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
     WHERE is_active = true
       AND (id::text = ANY($1::text[]) OR backend_user_id = ANY($1::text[]))`,
    [ids],
  )
  for (const row of extras) {
    const payload = project({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
    })
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
  mustChangePassword: boolean
}

/**
 * Current user from `app_users` keyed by `backend_user_id`.
 * Inactive (`is_active = false`) and missing users return null so revoked
 * access cannot ride a still-valid JWT until expiry.
 *
 * `roleId` prefers `backend_role_id`, falling back to `app_roles.id` so roles
 * without a backend id still resolve permissions via `resolveAppRoleId`.
 */
export async function postgresFetchMe(backendUserId: string): Promise<PostgresMeUser | null> {
  const rows = await query<{
    id: string | null
    first_name: string | null
    last_name: string | null
    email: string | null
    role_id: string | null
    role_name: string | null
    is_admin: boolean | null
    must_change_password: boolean | null
  }>(
    `SELECT u.backend_user_id AS id,
            u.first_name,
            u.last_name,
            u.email,
            COALESCE(NULLIF(r.backend_role_id, ''), r.id::text) AS role_id,
            r.name AS role_name,
            COALESCE(r.is_admin, false) AS is_admin,
            COALESCE(c.must_change_password, false) AS must_change_password
     FROM public.app_users u
     LEFT JOIN public.app_roles r ON r.id = u.role_id
     LEFT JOIN public.app_user_credentials c ON c.user_id = u.id
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
    mustChangePassword: row.must_change_password === true,
  }
}

/** Process-local cache: once true, stay true; false rechecked after TTL. */
let hasAppUsersCache: boolean | null = null
let hasAppUsersCachedAt = 0
const HAS_APP_USERS_NEGATIVE_TTL_MS = 30_000

/** True once any users have been imported into app_users. */
export async function hasAppUsers(): Promise<boolean> {
  const now = Date.now()
  if (hasAppUsersCache === true) return true
  if (
    hasAppUsersCache === false &&
    now - hasAppUsersCachedAt < HAS_APP_USERS_NEGATIVE_TTL_MS
  ) {
    return false
  }
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM public.app_users WHERE backend_user_id IS NOT NULL
     ) AS exists`,
  )
  hasAppUsersCache = Boolean(rows[0]?.exists)
  hasAppUsersCachedAt = now
  return hasAppUsersCache
}

/** Test helper — clears the hasAppUsers process cache. */
export function clearHasAppUsersCache(): void {
  hasAppUsersCache = null
  hasAppUsersCachedAt = 0
}
