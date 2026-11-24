import { query } from '../db/pool.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import type { RecordAccess } from '../adapters/records/types.js'
import { isSystemRecordAccess } from '../adapters/records/types.js'
import {
  loadM2ORelations,
  loadO2MRelations,
} from '../adapters/records/relations.js'
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
 * (read vs write). Optional **same-role read** (`rowLevelReadAlsoIfSameRole`) lets
 * peers with the owner's app role read (not update/delete). No Teams object yet.
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
  /**
   * When true, any user with the same app role as the row owner may **read**
   * (list/get). Update/delete stay owner-only. Coarser than a future Teams object.
   */
  readAlsoIfSameRole: boolean
}

export type OwnerShareFilterOptions = {
  /** Backend user ids that share my role (includes me). Used for same-role read. */
  sameRolePeerIds?: string[] | null
}

/** Row owner (sharing). Distinct from audit `user_created`. */
export const ROW_OWNER_FIELD = 'owner_id'

export const CACHE_TTL_MS = 5_000
/** Serve last-good after a failed refresh; avoids retrying the DB on every request. */
export const CACHE_NEGATIVE_TTL_MS = 2_000

let modeCache: {
  byEntity: Map<string, EntityOwnerSecurityConfig>
  expiresAt: number
  epoch: number
} | null = null
let modeLoad: Promise<Map<string, EntityOwnerSecurityConfig>> | null = null

/** roleKey → peer backend_user_ids (short TTL). */
let peerIdsCache: {
  byRole: Map<string, { ids: string[]; expiresAt: number }>
  epoch: number
} | null = null

export function clearRowLevelSecurityCache(): void {
  modeCache = null
  modeLoad = null
  peerIdsCache = null
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

export function parseReadAlsoIfSameRole(raw: unknown): boolean {
  return raw === true || raw === 'true' || raw === 1 || raw === '1'
}

export function readReadAlsoIfSameRole(config: Record<string, unknown>): boolean {
  return parseReadAlsoIfSameRole(
    config.rowLevelReadAlsoIfSameRole ??
      config.readAlsoIfSameRole ??
      config.read_also_if_same_role,
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

  // Shared so concurrent callers see the same deny-or-last-good result.
  // A failed first load must reject (fail closed). Caching an empty map
  // would treat every entity as unsecured for CACHE_TTL_MS.
  const load = (async (): Promise<Map<string, EntityOwnerSecurityConfig>> => {
    try {
      const rows = await query<{
        api_name: string
        backend_config: unknown
      }>(
        `SELECT api_name, backend_config
         FROM public.entities
         WHERE deleted_at IS NULL`,
      )
      const byEntity = new Map<string, EntityOwnerSecurityConfig>()
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
          readAlsoIfSameRole: readReadAlsoIfSameRole(config),
        })
      }
      modeCache = {
        byEntity,
        expiresAt: Date.now() + CACHE_TTL_MS,
        epoch: await readCacheEpoch('row_level_security'),
      }
      return byEntity
    } catch (error) {
      console.warn('[rowLevelSecurity] failed to load entity modes', error)
      if (modeCache) {
        // Negative cache: keep last-good briefly so every request does not
        // re-hit a failing entities query until the DB recovers.
        modeCache.expiresAt = Date.now() + CACHE_NEGATIVE_TTL_MS
        return modeCache.byEntity
      }
      throw error
    }
  })()

  modeLoad = load
  try {
    return await load
  } finally {
    if (modeLoad === load) modeLoad = null
  }
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
      readAlsoIfSameRole: false,
    }
  )
}

/**
 * Backend user ids (`owner_id` values) for everyone on the given app role.
 * `roleKey` is `me.roleId` (backend_role_id or app_roles.id text).
 */
export async function listBackendUserIdsForRole(
  roleKey: string,
): Promise<string[]> {
  const key = String(roleKey || '').trim()
  if (!key) return []
  const epoch = await readCacheEpoch('row_level_security')
  if (
    peerIdsCache &&
    peerIdsCache.epoch === epoch &&
    peerIdsCache.byRole.has(key)
  ) {
    const hit = peerIdsCache.byRole.get(key)!
    if (hit.expiresAt > Date.now()) return hit.ids
  }
  try {
    const rows = await query<{ actor_id: string }>(
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(u.backend_user_id), ''), u.id::text) AS actor_id
       FROM public.app_users u
       INNER JOIN public.app_roles r ON r.id = u.role_id
       WHERE r.backend_role_id = $1 OR r.id::text = $1`,
      [key],
    )
    const ids = rows
      .map((row) => String(row.actor_id || '').trim())
      .filter(Boolean)
    if (!peerIdsCache || peerIdsCache.epoch !== epoch) {
      peerIdsCache = { byRole: new Map(), epoch }
    }
    peerIdsCache.byRole.set(key, {
      ids,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })
    return ids
  } catch (error) {
    console.warn('[rowLevelSecurity] failed to load same-role peers', error)
    return []
  }
}

/** Peer owner ids for same-role read, or null when the feature does not apply. */
export async function resolveSameRolePeerIds(
  me: MeUser | null | undefined,
  sameRoleEnabled: boolean,
): Promise<string[] | null> {
  if (!sameRoleEnabled || !me) return null
  const roleId = typeof me.roleId === 'string' ? me.roleId.trim() : ''
  if (!roleId) return null
  const ids = await listBackendUserIdsForRole(roleId)
  const myId = typeof me.id === 'string' ? me.id.trim() : ''
  if (myId && !ids.includes(myId)) return [...ids, myId]
  return ids
}

export async function resolveEntityRowLevelSecurity(
  entityApiName: string,
): Promise<RowLevelSecurityMode> {
  return (await resolveEntityOwnerSecurity(entityApiName)).mode
}

/**
 * Fields required on a loaded row for {@link assertOwnerAccessIfNeeded}.
 * Always fetch these for find-one even when the client omitted them (layout
 * field lists often exclude `owner_id` / read-share FKs).
 */
export async function ownerAccessCheckFields(
  entityApiName: string,
): Promise<string[]> {
  const config = await resolveEntityOwnerSecurity(entityApiName)
  if (config.mode !== 'owner') return []
  return Array.from(
    new Set([ROW_OWNER_FIELD, 'user_created', ...config.readAlsoIf]),
  )
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
  options: OwnerShareFilterOptions = {},
): Record<string, unknown> {
  const peerIds = (options.sameRolePeerIds ?? [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
  const clauses: Record<string, unknown>[] = []
  if (peerIds.length > 0) {
    clauses.push({ [ROW_OWNER_FIELD]: { _in: peerIds } })
  } else {
    clauses.push(ownerEqFilter(userId))
  }
  for (const field of readAlsoIf) {
    clauses.push({ [field]: { _eq: userId } })
  }
  if (clauses.length === 1) return clauses[0]!
  return { _or: clauses }
}

/**
 * AND the owner predicate into an existing Directus-style filter.
 * Empty / null filter → owner-only. Existing filter → `{ _and: [filter, owner] }`.
 */
export function mergeOwnerFilter(
  filter: Record<string, unknown> | null | undefined,
  userId: string,
  readAlsoIf: string[] = [],
  options: OwnerShareFilterOptions = {},
): Record<string, unknown> {
  const owner = ownerOrShareEqFilter(userId, readAlsoIf, options)
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

export type AssertRecordOwnerOptions = {
  /** When set, read is allowed if the row owner is in this set (same-role peers). */
  sameRolePeerIds?: string[] | null
}

/**
 * Throw when a non-admin user does not own the row.
 * Missing / null `owner_id` (and no legacy `user_created`) → denied.
 * For **read**, `readAlsoIf` fields may also grant access (e.g. message.to_user).
 * Optional `sameRolePeerIds` grants read when the owner is a role peer.
 */
export function assertRecordOwner(
  me: MeUser,
  entityApiName: string,
  record: Record<string, unknown>,
  action: 'read' | 'update' | 'delete' = 'read',
  readAlsoIf: string[] = [],
  options: AssertRecordOwnerOptions = {},
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
  if (
    action === 'read' &&
    ownerId &&
    Array.isArray(options.sameRolePeerIds) &&
    options.sameRolePeerIds.includes(ownerId)
  ) {
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
  const config = await resolveEntityOwnerSecurity(entityApiName)
  const sameRolePeerIds = await resolveSameRolePeerIds(
    me,
    config.readAlsoIfSameRole,
  )
  return mergeOwnerFilter(filter, myId, config.readAlsoIf, { sameRolePeerIds })
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
  const config = await resolveEntityOwnerSecurity(entityApiName)
  const readAlsoIf = action === 'read' ? config.readAlsoIf : []
  const sameRolePeerIds =
    action === 'read'
      ? await resolveSameRolePeerIds(me, config.readAlsoIfSameRole)
      : null
  assertRecordOwner(me, entityApiName, record, action, readAlsoIf, {
    sameRolePeerIds,
  })
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
  const config = await resolveEntityOwnerSecurity(entityApiName)
  const sameRolePeerIds = await resolveSameRolePeerIds(
    me,
    config.readAlsoIfSameRole,
  )
  return ownerOrShareEqFilter(myId, config.readAlsoIf, { sameRolePeerIds })
}

const RELATED_OWNER_FILTER_MAX_DEPTH = 8

function isPlainFilterObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Comparison ops (`_eq`, `_gt`, …) — not logical wrappers. */
function isComparisonFilterObject(value: unknown): boolean {
  if (!isPlainFilterObject(value)) return false
  const keys = Object.keys(value)
  if (!keys.length) return false
  return keys.every(
    (key) =>
      key.startsWith('_') &&
      key !== '_and' &&
      key !== '_or' &&
      key !== '_not' &&
      key !== '_some' &&
      key !== '_none',
  )
}

async function relatedEntityForFilterHop(
  entity: string,
  field: string,
): Promise<string | null> {
  const key = String(field || '')
    .trim()
    .toLowerCase()
  if (!key) return null
  const m2o = (await loadM2ORelations(entity)).find(
    (rel) => rel.fieldApiName.trim().toLowerCase() === key,
  )
  if (m2o?.relatedEntityApiName) return m2o.relatedEntityApiName
  const o2m = (await loadO2MRelations(entity)).find(
    (rel) => rel.fieldApiName.trim().toLowerCase() === key,
  )
  return o2m?.junctionEntityApiName ?? null
}

/**
 * Fail closed for backends that cannot AND a related-row owner predicate into
 * nested/dotted filters (Directus GraphQL). Throws when a hop targets an
 * owner-secured related entity that would need {@link relatedOwnerFilterIfNeeded}.
 * Admins / View all / RLS-off related entities are allowed.
 */
export async function assertRelatedOwnerFilterHopsSupported(
  entityApiName: string,
  filter: unknown,
  me: MeUser | null | undefined,
  depth = 0,
): Promise<void> {
  if (depth > RELATED_OWNER_FILTER_MAX_DEPTH) return
  if (Array.isArray(filter)) {
    for (const item of filter) {
      await assertRelatedOwnerFilterHopsSupported(
        entityApiName,
        item,
        me,
        depth + 1,
      )
    }
    return
  }
  if (!isPlainFilterObject(filter)) return

  for (const [key, value] of Object.entries(filter)) {
    if (key === '_and' || key === '_or' || key === '_not') {
      await assertRelatedOwnerFilterHopsSupported(
        entityApiName,
        value,
        me,
        depth + 1,
      )
      continue
    }
    if (key.startsWith('_')) continue

    if (key.includes('.')) {
      const [root, ...rest] = key
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean)
      if (!root || !rest.length) continue
      const related = await relatedEntityForFilterHop(entityApiName, root)
      if (!related) continue
      const ownerFilter = await relatedOwnerFilterIfNeeded(related, me)
      if (ownerFilter) {
        throw new Error(
          `Permission denied: related owner row security cannot be applied on Directus filters for ${related}`,
        )
      }
      if (rest.length === 1 && isComparisonFilterObject(value)) continue
      await assertRelatedOwnerFilterHopsSupported(
        related,
        rest.length === 1 ? value : { [rest.join('.')]: value },
        me,
        depth + 1,
      )
      continue
    }

    if (!isPlainFilterObject(value) || isComparisonFilterObject(value)) continue

    const nested: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childKey === '_some' || childKey === '_none') {
        if (isPlainFilterObject(childValue)) Object.assign(nested, childValue)
      } else if (!childKey.startsWith('_')) {
        nested[childKey] = childValue
      }
    }
    if (!Object.keys(nested).length) continue
    const related = await relatedEntityForFilterHop(entityApiName, key)
    if (!related) continue
    const ownerFilter = await relatedOwnerFilterIfNeeded(related, me)
    if (ownerFilter) {
      throw new Error(
        `Permission denied: related owner row security cannot be applied on Directus filters for ${related}`,
      )
    }
    await assertRelatedOwnerFilterHopsSupported(
      related,
      nested,
      me,
      depth + 1,
    )
  }
}

/**
 * SQL AND-fragment for a related-table alias (`r.owner_id = $n`).
 * `ownerColumnExpr` must already be a safe identifier/expression (not user input).
 * When `readAlsoIf` is set, OR those columns on the same alias (`r.to_user = $n`).
 * Same-role read ORs `owner_id = ANY(peerIds)`.
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
  const sameRolePeerIds = await resolveSameRolePeerIds(
    me,
    config.readAlsoIfSameRole,
  )
  const parts: string[] = []
  const params: unknown[] = []
  if (sameRolePeerIds && sameRolePeerIds.length > 0) {
    parts.push(`(${ownerColumnExpr}) = ANY($${paramIndex}::text[])`)
    params.push(sameRolePeerIds)
  } else {
    parts.push(`(${ownerColumnExpr}) = $${paramIndex}`)
    params.push(myId)
  }
  const shareParam =
    sameRolePeerIds && sameRolePeerIds.length > 0
      ? paramIndex + 1
      : paramIndex
  if (config.readAlsoIf.length && shareParam !== paramIndex) {
    params.push(myId)
  }
  for (const field of config.readAlsoIf) {
    parts.push(`(${tableAlias}.${field}) = $${shareParam}`)
  }
  return {
    sql: parts.length === 1 ? parts[0]! : `(${parts.join(' OR ')})`,
    params,
  }
}
