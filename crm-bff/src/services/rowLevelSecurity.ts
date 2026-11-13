import { query } from '../db/pool.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import type { RecordAccess } from '../adapters/records/types.js'
import { isSystemRecordAccess } from '../adapters/records/types.js'

/**
 * Owner-based row-level security (MVP).
 *
 * Opt-in per entity via `backend_config.rowLevelSecurity = "owner"`.
 * Non-admin users may only list/read/update/delete rows where
 * `user_created` equals their `backend_user_id`. Admins and
 * `SYSTEM_RECORD_ACCESS` bypass. No share table / hierarchy yet.
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

/**
 * When entity is owner-secured and caller is a non-admin user, return a
 * filter that restricts to their rows. Otherwise return the input filter.
 */
export async function applyOwnerFilterIfNeeded(
  entityApiName: string,
  access: RecordAccess,
  filter: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null | undefined> {
  if (bypassesRowLevelSecurity(access)) return filter
  const mode = await resolveEntityRowLevelSecurity(entityApiName)
  if (mode !== 'owner') return filter
  const me = access.me
  const myId = me && typeof me.id === 'string' ? me.id.trim() : ''
  if (!myId) {
    throw new Error(`Permission denied: read on ${entityApiName}`)
  }
  return mergeOwnerFilter(filter, myId)
}

/**
 * After loading a row by id: enforce owner mode for non-admin callers.
 * No-op when entity is not owner-secured or caller bypasses.
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
  const me = access.me
  if (!me) {
    throw new Error(`Permission denied: ${action} on ${entityApiName}`)
  }
  assertRecordOwner(me, entityApiName, record, action)
}
