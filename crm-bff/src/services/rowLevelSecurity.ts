import { query } from '../db/pool.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import type { RecordAccess } from '../adapters/records/types.js'
import { isSystemRecordAccess } from '../adapters/records/types.js'
import { resolveRoleOwnerBypass } from './rolePermissions.js'

/**
 * Owner-based row-level security (MVP).
 *
 * Opt-in per entity via `backend_config.rowLevelSecurity = "owner"`.
 * Non-admin users may only list/read/update/delete rows where
 * `user_created` equals `me.id`. That id is `app_users.backend_user_id`
 * (see `postgresFetchMe` / `actorIdFromMe`) — the same value stamped into
 * `user_created` on create. It is **not** the app_users UUID PK.
 * Legacy rows with null `user_created` are invisible to non-admins (by design).
 * Admins, `SYSTEM_RECORD_ACCESS`, and role **View All** / **Modify All** bypass
 * (read vs write). No share table / hierarchy yet.
 *
 * Enforcement surface (keep in sync when adding loaders):
 * - Facade: `findManyRecords` / `findOneRecord` / update / delete / `aggregateRecords`
 *   (also covers REST `/api/v1/*`, SOQL `/api/v1/query`, M2O/O2M/M2A expand,
 *   reverse-child expand, and bulk actions that call the facade).
 * - GraphQL: `record` / `records` / mutations via facade; `recordActivities`,
 *   `recordRevisions`, `recordFiles`, and `bulkUpdateRelatedFromAction` assert
 *   parent readability via `findOneRecord` before side reads/writes.
 */

export type RowLevelSecurityMode = 'owner' | null

/** Audit Created By — stamped on create; used as owner for MVP. */
export const ROW_OWNER_FIELD = 'user_created'

const CACHE_TTL_MS = 30_000

let modeCache: {
  byEntity: Map<string, RowLevelSecurityMode>
  expiresAt: number
} | null = null
let modeLoad: Promise<Map<string, RowLevelSecurityMode>> | null = null

export function clearRowLevelSecurityCache(): void {
  modeCache = null
  modeLoad = null
}

export function parseRowLevelSecurity(raw: unknown): RowLevelSecurityMode {
  if (raw === 'owner') return 'owner'
  return null
}

export function readRowLevelSecurity(
  config: Record<string, unknown>,
): RowLevelSecurityMode {
  return parseRowLevelSecurity(config.rowLevelSecurity)
}

function entityKey(entity: string): string {
  return String(entity || '')
    .trim()
    .toLowerCase()
}

async function loadModes(): Promise<Map<string, RowLevelSecurityMode>> {
  if (modeCache && modeCache.expiresAt > Date.now()) {
    return modeCache.byEntity
  }
  if (modeLoad) return modeLoad

  modeLoad = (async () => {
    const byEntity = new Map<string, RowLevelSecurityMode>()
    try {
      const rows = await query<{
        api_name: string
        backend_config: unknown
      }>(
        `SELECT api_name, backend_config
         FROM public.entities
         WHERE deleted_at IS NULL`,
      )
      for (const row of rows) {
        const config =
          row.backend_config &&
          typeof row.backend_config === 'object' &&
          !Array.isArray(row.backend_config)
            ? (row.backend_config as Record<string, unknown>)
            : {}
        byEntity.set(entityKey(row.api_name), readRowLevelSecurity(config))
      }
    } catch (error) {
      console.warn('[rowLevelSecurity] failed to load entity modes', error)
    }
    modeCache = { byEntity, expiresAt: Date.now() + CACHE_TTL_MS }
    modeLoad = null
    return byEntity
  })()

  return modeLoad
}

export async function resolveEntityRowLevelSecurity(
  entityApiName: string,
): Promise<RowLevelSecurityMode> {
  const modes = await loadModes()
  return modes.get(entityKey(entityApiName)) ?? null
}

export function isAdminMe(me: MeUser | null | undefined): boolean {
  if (!me) return false
  return Boolean(me.adminAccess || me.roleAdminAccess)
}

/** System callers and admins skip owner filters / asserts. */
export function bypassesRowLevelSecurity(access: RecordAccess): boolean {
  if (isSystemRecordAccess(access)) return true
  return isAdminMe(access.me)
}

export function ownerEqFilter(userId: string): Record<string, unknown> {
  return { [ROW_OWNER_FIELD]: { _eq: userId } }
}

/**
 * AND the owner predicate into an existing Directus-style filter.
 * Empty / null filter → owner-only. Existing filter → `{ _and: [filter, owner] }`.
 */
export function mergeOwnerFilter(
  filter: Record<string, unknown> | null | undefined,
  userId: string,
): Record<string, unknown> {
  const owner = ownerEqFilter(userId)
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    return owner
  }
  const keys = Object.keys(filter)
  if (!keys.length) return owner
  return { _and: [filter, owner] }
}

function scalarOwnerId(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number') {
    const s = String(value).trim()
    return s || null
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if (obj.id != null) return scalarOwnerId(obj.id)
  }
  return null
}

export function readRecordOwnerId(record: Record<string, unknown>): string | null {
  return scalarOwnerId(record[ROW_OWNER_FIELD])
}

/**
 * Throw when a non-admin user does not own the row.
 * Missing / null `user_created` → denied (legacy rows need backfill or admin).
 */
export function assertRecordOwner(
  me: MeUser,
  entityApiName: string,
  record: Record<string, unknown>,
  action: 'read' | 'update' | 'delete' = 'read',
): void {
  if (isAdminMe(me)) return
  const myId = typeof me.id === 'string' ? me.id.trim() : ''
  if (!myId) {
    throw new Error(`Permission denied: ${action} on ${entityApiName}`)
  }
  const ownerId = readRecordOwnerId(record)
  if (!ownerId || ownerId !== myId) {
    throw new Error(`Permission denied: ${action} on ${entityApiName}`)
  }
}

async function roleBypassesOwnerForAction(
  me: MeUser | null | undefined,
  entityApiName: string,
  action: 'read' | 'update' | 'delete',
): Promise<boolean> {
  if (!me) return false
  const scope = await resolveRoleOwnerBypass(me, entityApiName)
  if (action === 'read') return scope.viewAll
  return scope.modifyAll
}

/**
 * When entity is owner-secured and caller is a non-admin user without View All,
 * return a filter that restricts to their rows. Otherwise return the input filter.
 */
export async function applyOwnerFilterIfNeeded(
  entityApiName: string,
  access: RecordAccess,
  filter: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null | undefined> {
  if (bypassesRowLevelSecurity(access)) return filter
  const mode = await resolveEntityRowLevelSecurity(entityApiName)
  if (mode !== 'owner') return filter
  if (await roleBypassesOwnerForAction(access.me, entityApiName, 'read')) {
    return filter
  }
  const me = access.me
  const myId = me && typeof me.id === 'string' ? me.id.trim() : ''
  if (!myId) {
    throw new Error(`Permission denied: read on ${entityApiName}`)
  }
  return mergeOwnerFilter(filter, myId)
}

/**
 * After loading a row by id: enforce owner mode for non-admin callers.
 * No-op when entity is not owner-secured, caller is admin/system, or role has
 * View All (read) / Modify All (update|delete).
 */
export async function assertOwnerAccessIfNeeded(
  entityApiName: string,
  access: RecordAccess,
  record: Record<string, unknown>,
  action: 'read' | 'update' | 'delete' = 'read',
): Promise<void> {
  if (bypassesRowLevelSecurity(access)) return
  const mode = await resolveEntityRowLevelSecurity(entityApiName)
  if (mode !== 'owner') return
  if (await roleBypassesOwnerForAction(access.me, entityApiName, action)) {
    return
  }
  const me = access.me
  if (!me) {
    throw new Error(`Permission denied: ${action} on ${entityApiName}`)
  }
  assertRecordOwner(me, entityApiName, record, action)
}

/**
 * Owner predicate for nested/related queries (M2O EXISTS, Hasura related search).
 * Returns null when no restriction applies (off, admin, View All, system).
 * Returns an impossible filter when the caller has no usable id (deny).
 */
export async function relatedOwnerFilterIfNeeded(
  entityApiName: string,
  me: MeUser | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (!me || isAdminMe(me)) return null
  const mode = await resolveEntityRowLevelSecurity(entityApiName)
  if (mode !== 'owner') return null
  if (await roleBypassesOwnerForAction(me, entityApiName, 'read')) return null
  const myId = typeof me.id === 'string' ? me.id.trim() : ''
  if (!myId) {
    // No actor id → match nothing (do not widen to all rows).
    return { [ROW_OWNER_FIELD]: { _eq: '__rls_deny__' } }
  }
  return ownerEqFilter(myId)
}

/**
 * SQL AND-fragment for a related-table alias (`r.user_created = $n`).
 * `ownerColumnExpr` must already be a safe identifier/expression (not user input).
 */
export async function relatedOwnerSqlIfNeeded(
  entityApiName: string,
  me: MeUser | null | undefined,
  ownerColumnExpr: string,
  paramIndex: number,
): Promise<{ sql: string; params: unknown[] } | null> {
  if (!me || isAdminMe(me)) return null
  const mode = await resolveEntityRowLevelSecurity(entityApiName)
  if (mode !== 'owner') return null
  if (await roleBypassesOwnerForAction(me, entityApiName, 'read')) return null
  const myId = typeof me.id === 'string' ? me.id.trim() : ''
  if (!myId) return { sql: 'FALSE', params: [] }
  return {
    sql: `(${ownerColumnExpr}) = $${paramIndex}`,
    params: [myId],
  }
}
