import { query } from '../db/pool.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import type { RecordAccess } from '../adapters/records/types.js'
import { isSystemRecordAccess } from '../adapters/records/types.js'
import { resolveRoleOwnerBypass } from './rolePermissions.js'
import { bumpCacheEpoch, readCacheEpoch } from './cacheEpoch.js'

/**
 * Owner-based row-level security (MVP).
 *
 * Opt-in per entity via `backend_config.rowLevelSecurity = "owner"`.
 * Non-admin users may only list/read/update/delete rows where
 * `owner_id` equals `me.id`. That id is `app_users.backend_user_id`
 * (see `postgresFetchMe` / `actorIdFromMe`) — the same value stamped into
 * `owner_id` on create (and into `user_created` as the audit actor).
 * It is **not** the app_users UUID PK.
 * Legacy rows with null `owner_id` fall back to `user_created` for reads;
 * after migration backfill, filters use `owner_id` only.
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

export type EntityOwnerSecurityConfig = {
  mode: RowLevelSecurityMode
  /**
   * M2O field on this entity whose related row's `owner_id` is copied
   * onto new children's `owner_id` (Salesforce-style master-detail ownership).
   * `user_created` stays the creating actor.
   */
  inheritOwnerFrom: string | null
  /**
   * Extra UUID fields that grant **read** access when equal to `me.id`
   * (OR with owner). Used for Message inbox (`to_user`). Update/delete stay owner-only.
   */
  readAlsoIf: string[]
}

/** Row owner (sharing). Distinct from audit `user_created`. */
export const ROW_OWNER_FIELD = 'owner_id'

const CACHE_TTL_MS = 5_000

let modeCache: {
  byEntity: Map<string, EntityOwnerSecurityConfig>
  expiresAt: number
  epoch: number
} | null = null
let modeLoad: Promise<Map<string, EntityOwnerSecurityConfig>> | null = null

export function clearRowLevelSecurityCache(): void {
  modeCache = null
  modeLoad = null
  void bumpCacheEpoch('row_level_security')
}

export function parseRowLevelSecurity(raw: unknown): RowLevelSecurityMode {
  if (raw === 'owner') return 'owner'
  return null
}

export function parseInheritOwnerFrom(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed || !/^[a-z][a-z0-9_]*$/.test(trimmed)) return null
  return trimmed
}

export function readRowLevelSecurity(
  config: Record<string, unknown>,
): RowLevelSecurityMode {
  return parseRowLevelSecurity(config.rowLevelSecurity)
}

export function readInheritOwnerFrom(
  config: Record<string, unknown>,
): string | null {
  return parseInheritOwnerFrom(config.inheritOwnerFrom)
}

/** Safe field api_names for read-share OR clauses. */
export function parseReadAlsoIf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const field = entry.trim().toLowerCase()
    if (!field || !/^[a-z][a-z0-9_]*$/.test(field)) continue
    if (field === ROW_OWNER_FIELD || field === 'user_created') continue
    if (seen.has(field)) continue
    seen.add(field)
    out.push(field)
  }
  return out
}

export function readReadAlsoIf(config: Record<string, unknown>): string[] {
  return parseReadAlsoIf(
    config.rowLevelReadAlsoIf ?? config.readAlsoIf ?? config.read_also_if,
  )
}

function entityKey(entity: string): string {
  return String(entity || '')
    .trim()
    .toLowerCase()
}

async function loadOwnerConfigs(): Promise<Map<string, EntityOwnerSecurityConfig>> {
  const epoch = await readCacheEpoch('row_level_security')
  if (modeCache && modeCache.expiresAt > Date.now() && modeCache.epoch === epoch) {
    return modeCache.byEntity
  }
  if (modeLoad) return modeLoad

  modeLoad = (async () => {
    const byEntity = new Map<string, EntityOwnerSecurityConfig>()
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
        byEntity.set(entityKey(row.api_name), {
          mode: readRowLevelSecurity(config),
          inheritOwnerFrom: readInheritOwnerFrom(config),
          readAlsoIf: readReadAlsoIf(config),
        })
      }
    } catch (error) {
      console.warn('[rowLevelSecurity] failed to load entity modes', error)
    }
    modeCache = {
      byEntity,
      expiresAt: Date.now() + CACHE_TTL_MS,
      epoch: await readCacheEpoch('row_level_security'),
    }
    modeLoad = null
    return byEntity
  })()

  return modeLoad
}

export async function resolveEntityOwnerSecurity(
  entityApiName: string,
): Promise<EntityOwnerSecurityConfig> {
  const configs = await loadOwnerConfigs()
  return (
    configs.get(entityKey(entityApiName)) ?? {
      mode: null,
      inheritOwnerFrom: null,
      readAlsoIf: [],
    }
  )
}

export async function resolveEntityRowLevelSecurity(
  entityApiName: string,
): Promise<RowLevelSecurityMode> {
  return (await resolveEntityOwnerSecurity(entityApiName)).mode
}

/** Parent M2O field used to inherit `owner_id` on create, or null. */
export async function resolveInheritOwnerFrom(
  entityApiName: string,
): Promise<string | null> {
  return (await resolveEntityOwnerSecurity(entityApiName)).inheritOwnerFrom
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

/** Owner OR any readAlsoIf field equals userId (inbox / share reads). */
export function ownerOrShareEqFilter(
  userId: string,
  readAlsoIf: string[] = [],
): Record<string, unknown> {
  if (!readAlsoIf.length) return ownerEqFilter(userId)
  return {
    _or: [
      ownerEqFilter(userId),
      ...readAlsoIf.map((field) => ({ [field]: { _eq: userId } })),
    ],
  }
}

/**
 * AND the owner predicate into an existing Directus-style filter.
 * Empty / null filter → owner-only. Existing filter → `{ _and: [filter, owner] }`.
 */
export function mergeOwnerFilter(
  filter: Record<string, unknown> | null | undefined,
  userId: string,
  readAlsoIf: string[] = [],
): Record<string, unknown> {
  const owner = ownerOrShareEqFilter(userId, readAlsoIf)
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
  return (
    scalarOwnerId(record[ROW_OWNER_FIELD]) ??
    // Pre-migration / un-backfilled rows used user_created as owner.
    scalarOwnerId(record.user_created)
  )
}

export function recordMatchesReadShare(
  record: Record<string, unknown>,
  userId: string,
  readAlsoIf: string[],
): boolean {
  for (const field of readAlsoIf) {
    const value = scalarOwnerId(record[field])
    if (value && value === userId) return true
  }
  return false
}

/**
 * Throw when a non-admin user does not own the row.
 * Missing / null `owner_id` (and no legacy `user_created`) → denied.
 * For **read**, `readAlsoIf` fields may also grant access (e.g. message.to_user).
 */
export function assertRecordOwner(
  me: MeUser,
  entityApiName: string,
  record: Record<string, unknown>,
  action: 'read' | 'update' | 'delete' = 'read',
  readAlsoIf: string[] = [],
): void {
  if (isAdminMe(me)) return
  const myId = typeof me.id === 'string' ? me.id.trim() : ''
  if (!myId) {
    throw new Error(`Permission denied: ${action} on ${entityApiName}`)
  }
  const ownerId = readRecordOwnerId(record)
  if (ownerId && ownerId === myId) return
  if (action === 'read' && recordMatchesReadShare(record, myId, readAlsoIf)) {
    return
  }
  throw new Error(`Permission denied: ${action} on ${entityApiName}`)
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
  const readAlsoIf = (await resolveEntityOwnerSecurity(entityApiName)).readAlsoIf
  return mergeOwnerFilter(filter, myId, readAlsoIf)
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
  const readAlsoIf =
    action === 'read'
      ? (await resolveEntityOwnerSecurity(entityApiName)).readAlsoIf
      : []
  assertRecordOwner(me, entityApiName, record, action, readAlsoIf)
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
  const readAlsoIf = (await resolveEntityOwnerSecurity(entityApiName)).readAlsoIf
  return ownerOrShareEqFilter(myId, readAlsoIf)
}

/**
 * SQL AND-fragment for a related-table alias (`r.owner_id = $n`).
 * `ownerColumnExpr` must already be a safe identifier/expression (not user input).
 * When `readAlsoIf` is set, OR those columns on the same alias (`r.to_user = $n`).
 */
export async function relatedOwnerSqlIfNeeded(
  entityApiName: string,
  me: MeUser | null | undefined,
  ownerColumnExpr: string,
  paramIndex: number,
  tableAlias = 'r',
): Promise<{ sql: string; params: unknown[] } | null> {
  if (!me || isAdminMe(me)) return null
  const config = await resolveEntityOwnerSecurity(entityApiName)
  if (config.mode !== 'owner') return null
  if (await roleBypassesOwnerForAction(me, entityApiName, 'read')) return null
  const myId = typeof me.id === 'string' ? me.id.trim() : ''
  if (!myId) return { sql: 'FALSE', params: [] }
  const parts = [`(${ownerColumnExpr}) = $${paramIndex}`]
  for (const field of config.readAlsoIf) {
    parts.push(`(${tableAlias}.${field}) = $${paramIndex}`)
  }
  return {
    sql: parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`,
    params: [myId],
  }
}
