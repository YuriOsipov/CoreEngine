import { query } from '../db/pool.js'
import {
  USERS_ADMIN_ONLY_FIELDS,
  USERS_ASSET_COLLECTION,
} from '../users/userNames.js'

/** Always-safe base columns for label / picker projection. */
const BASE_USER_COLUMNS = [
  'first_name',
  'last_name',
  'email',
  'role_id',
  'is_active',
] as const

const DEFAULT_USER_LIST_FIELDS = ['id', 'first_name', 'last_name'] as const
const MAX_USER_LIST_LIMIT = 200

const PROFILE_COLUMN_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Process cache: physical columns on public.app_users. */
let physicalColumnsCache: Set<string> | null = null
let physicalColumnsCachedAt = 0
/** Process cache: registry field api_names for entity `users`. */
let registryFieldsCache: string[] | null = null
let registryFieldsCachedAt = 0
const PROFILE_CACHE_TTL_MS = 30_000

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`
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

export function clearUsersProfileColumnCache(): void {
  physicalColumnsCache = null
  physicalColumnsCachedAt = 0
  registryFieldsCache = null
  registryFieldsCachedAt = 0
}

async function loadAppUsersPhysicalColumns(): Promise<Set<string>> {
  const now = Date.now()
  if (
    physicalColumnsCache &&
    now - physicalColumnsCachedAt < PROFILE_CACHE_TTL_MS
  ) {
    return physicalColumnsCache
  }
  const rows = await query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'app_users'`,
  )
  physicalColumnsCache = new Set(
    rows.map((row) => String(row.column_name)).filter(Boolean),
  )
  physicalColumnsCachedAt = now
  return physicalColumnsCache
}

async function loadUsersRegistryFieldNames(): Promise<string[]> {
  const now = Date.now()
  if (
    registryFieldsCache &&
    now - registryFieldsCachedAt < PROFILE_CACHE_TTL_MS
  ) {
    return registryFieldsCache
  }
  const rows = await query<{ api_name: string }>(
    `SELECT f.api_name
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1
       AND e.deleted_at IS NULL`,
    [USERS_ASSET_COLLECTION],
  )
  registryFieldsCache = rows
    .map((row) => String(row.api_name || '').trim())
    .filter((name) => PROFILE_COLUMN_RE.test(name))
  registryFieldsCachedAt = now
  return registryFieldsCache
}

/**
 * Registry ∩ physical columns on `app_users` (never credentials).
 * Used for SELECT list and profile updates.
 */
export async function resolveUsersProfileColumns(): Promise<string[]> {
  const [physical, registry] = await Promise.all([
    loadAppUsersPhysicalColumns(),
    loadUsersRegistryFieldNames(),
  ])
  const out = new Set<string>(BASE_USER_COLUMNS)
  for (const name of registry) {
    if (physical.has(name)) out.add(name)
  }
  // Never expose id via profile list as a selectable data column — projected separately.
  out.delete('id')
  return [...out].sort()
}

function aliasForRequestedField(key: string): string | null {
  if (key === 'id') return 'id'
  if (key === 'firstName') return 'first_name'
  if (key === 'lastName') return 'last_name'
  if (PROFILE_COLUMN_RE.test(key)) return key
  return null
}

/** Project only allowlisted keys — client `fields` never touch SQL. */
function projectUserRow(
  row: Record<string, unknown>,
  fields: string[] | null | undefined,
  includeEmail: boolean,
  selectable: Set<string>,
  /** When true (detail-by-id), omit fields → return full profile projection. */
  fullProfileDefault = false,
): Record<string, unknown> {
  const requested =
    fields?.map((field) => String(field || '').trim()).filter(Boolean) ?? []
  const keys = requested.length
    ? requested
    : fullProfileDefault
      ? ['id', ...selectable]
      : [...DEFAULT_USER_LIST_FIELDS]
  const out: Record<string, unknown> = {}
  let sawId = false
  for (const key of keys) {
    const column = aliasForRequestedField(key)
    if (!column) continue
    if (column === 'id') {
      out[key] = row.id
      sawId = true
      continue
    }
    if (!selectable.has(column)) continue
    if (column === 'email' && !includeEmail) continue
    if (!(column in row)) continue
    out[key] = row[column]
  }
  if (!sawId) out.id = row.id
  return out
}

function buildSelectSql(profileColumns: string[]): string {
  const cols = [
    `COALESCE(NULLIF(backend_user_id, ''), id::text) AS id`,
    ...profileColumns.map((col) => quoteIdent(col)),
  ]
  return cols.join(', ')
}

/**
 * Serve user labels/pickers / record pages from Supabase `app_users`.
 * Returns `id = backend_user_id` so record `user_created` / `user_updated`
 * values keep resolving to names.
 *
 * SQL always selects allowlisted columns from `app_users` only — never
 * `app_user_credentials` / password hashes. Client `fields` / `sort` are not
 * interpolated into SQL (`fields` is post-query allowlist projection; `sort`
 * is ignored). Emails are omitted unless `includeEmail` or an id lookup.
 */
export async function postgresListUsers(options: {
  ids?: string[] | null
  search?: string | null
  fields?: string[] | null
  limit?: number | null
  sort?: string[] | null
  /** When false (default), email is never projected even if requested in fields. */
  includeEmail?: boolean
  /** When true (detail by id), include inactive users. */
  includeInactive?: boolean
}): Promise<Record<string, unknown>[]> {
  const ids = (options.ids ?? []).map(String).filter(Boolean)
  const searchText = options.search?.trim() || ''
  // Id lookups (detail / audit) include email so Block Layout can render it.
  const includeEmail = options.includeEmail === true || ids.length > 0
  const includeInactive = options.includeInactive === true || ids.length > 0

  // Don't dump all users unless ids/search/limit is provided.
  if (ids.length === 0 && !searchText && options.limit == null) return []

  const profileColumns = await resolveUsersProfileColumns()
  const selectable = new Set(profileColumns)
  const selectSql = buildSelectSql(profileColumns)

  const where: string[] = ['backend_user_id IS NOT NULL']
  if (!includeInactive) where.push('is_active = true')
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
    // Non-admins must not be able to probe emails via search.
    where.push(
      includeEmail
        ? `(first_name ILIKE $${next} ESCAPE '\\' OR last_name ILIKE $${next} ESCAPE '\\' OR email ILIKE $${next} ESCAPE '\\')`
        : `(first_name ILIKE $${next} ESCAPE '\\' OR last_name ILIKE $${next} ESCAPE '\\')`,
    )
    params.push(`%${escapeIlikePattern(searchText)}%`)
    next += 1
  }

  const limit = resolveListLimit(options.limit, ids.length)
  params.push(limit)
  const limitSql = `$${next}`

  const rows = await query<Record<string, unknown>>(
    `SELECT ${selectSql}
     FROM public.app_users
     WHERE ${where.join(' AND ')}
     ORDER BY first_name NULLS LAST, last_name NULLS LAST
     LIMIT ${limitSql}`,
    params,
  )

  const fullProfileDefault = ids.length > 0
  const project = (row: Record<string, unknown>) =>
    projectUserRow(
      row,
      options.fields,
      includeEmail,
      selectable,
      fullProfileDefault,
    )

  // Prefer matching the requested id when both app id and backend_user_id exist.
  if (ids.length === 0) return rows.map(project)

  const byRequested = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    byRequested.set(String(row.id), project(row))
  }
  // Also index by raw lookup so stamps that used app_users.id still resolve.
  const extras = await query<Record<string, unknown>>(
    `SELECT id::text AS match_id,
            ${selectSql}
     FROM public.app_users
     WHERE (id::text = ANY($1::text[]) OR backend_user_id = ANY($1::text[]))
       ${includeInactive ? '' : 'AND is_active = true'}`,
    [ids],
  )
  for (const row of extras) {
    const payload = project(row)
    byRequested.set(String(row.match_id), payload)
    byRequested.set(String(row.id), payload)
  }
  return ids
    .map((id) => byRequested.get(id))
    .filter((row): row is Record<string, unknown> => Boolean(row))
}

/**
 * Update profile / layout fields on `app_users`. Strips admin-only keys
 * (role_id, is_active, auth ids, passwords) — those stay on Setup → Users.
 */
export async function postgresUpdateUserProfile(
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const profileColumns = await resolveUsersProfileColumns()
  const writable = profileColumns.filter(
    (col) => !USERS_ADMIN_ONLY_FIELDS.has(col),
  )
  const writableSet = new Set(writable)
  const sets: string[] = []
  const params: unknown[] = []
  let next = 1

  for (const [key, value] of Object.entries(data)) {
    const column = aliasForRequestedField(key)
    if (!column || column === 'id') continue
    if (USERS_ADMIN_ONLY_FIELDS.has(column)) continue
    if (!writableSet.has(column)) continue
    sets.push(`${quoteIdent(column)} = $${next}`)
    params.push(value === undefined ? null : value)
    next += 1
  }

  if (sets.length === 0) {
    const existing = await postgresListUsers({
      ids: [id],
      fields: null,
      limit: 1,
      includeEmail: true,
      includeInactive: true,
    })
    const row = existing[0]
    if (!row) throw new Error(`User not found: ${id}`)
    return row
  }

  sets.push('updated_at = now()')
  params.push(id)
  const idParam = `$${next}`

  const updated = await query<{ id: string }>(
    `UPDATE public.app_users
     SET ${sets.join(', ')}
     WHERE backend_user_id = ${idParam} OR id::text = ${idParam}
     RETURNING COALESCE(NULLIF(backend_user_id, ''), id::text) AS id`,
    params,
  )
  const updatedId = updated[0]?.id
  if (!updatedId) throw new Error(`User not found: ${id}`)

  clearUsersProfileColumnCache()

  const rows = await postgresListUsers({
    ids: [updatedId],
    fields: null,
    limit: 1,
    includeEmail: true,
    includeInactive: true,
  })
  const row = rows[0]
  if (!row) throw new Error(`User not found: ${id}`)
  return row
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
 *
 * `token` (verified JWT claims) enforces revocation: iat must not predate
 * credentials.tokens_valid_after and the jti must not be on the logout denylist.
 */
export async function postgresFetchMe(
  backendUserId: string,
  token?: { iat: number; jti: string | null },
): Promise<PostgresMeUser | null> {
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
       AND (
         $2::bigint IS NULL
         OR c.tokens_valid_after IS NULL
         OR $2::bigint >= floor(extract(epoch FROM c.tokens_valid_after))::bigint
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.app_revoked_access_tokens t WHERE t.jti = $3
       )
     LIMIT 1`,
    [backendUserId, token ? token.iat : null, token?.jti ?? null],
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
  clearUsersProfileColumnCache()
}
