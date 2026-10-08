import { query } from '../../db/pool.js'
import { isRegistryPlatformEntity } from '../../schema/platformEntities.js'
import { clearCrmStorageCache } from '../../schema/crmStorage.js'
import { supabaseRecordsStore } from './backends/supabase/store.js'
import { hasuraRecordsStore } from './backends/hasura/store.js'
import { directusRecordsStore } from './backends/directus/store.js'
import { clearRecordRelationsCache } from './relations.js'
import {
  clearCanonicalEntityNameCache,
  resolveCanonicalEntityApiName,
} from './entityName.js'
import type { LiveRecordsBackendId, RecordsStore } from './types.js'

export type RecordsBackend = LiveRecordsBackendId | 'STRAPI' | 'PAYLOAD' | 'PLATFORM'

const LIVE_STORES: Record<string, RecordsStore> = {
  SUPABASE: supabaseRecordsStore,
  POSTGRES: supabaseRecordsStore,
  HASURA: hasuraRecordsStore,
  DIRECTUS: directusRecordsStore,
}

const REFUSE: Record<string, string> = {
  PLATFORM: 'backend_target=PLATFORM; use layout / user-setting / recent-views APIs',
  STRAPI: 'backend_target=STRAPI is not implemented; use SUPABASE, HASURA, or DIRECTUS',
  PAYLOAD: 'backend_target=PAYLOAD is not implemented; use SUPABASE, HASURA, or DIRECTUS',
}

const storeCache = new Map<string, RecordsStore>()

function refuseRecordsBackend(entityApiName: string, reason: string): never {
  throw new Error(`Records backend refused for "${entityApiName}": ${reason}`)
}

function envForceTarget(): string | null {
  const value = (process.env.RECORDS_BACKEND || '').trim().toUpperCase()
  return value || null
}

function envEntityAllowList(): Set<string> | null {
  const raw = (process.env.RECORDS_BACKEND_ENTITIES || '').trim()
  if (!raw) return null
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
}

function storeForTarget(entityApiName: string, target: string): RecordsStore {
  const key = target.toUpperCase()
  if (key in REFUSE) {
    refuseRecordsBackend(entityApiName, REFUSE[key]!)
  }
  const store = LIVE_STORES[key] ?? LIVE_STORES.SUPABASE
  if (!store) {
    refuseRecordsBackend(entityApiName, `Unknown backend_target=${key}`)
  }
  return store
}

export function clearRecordsBackendCache(): void {
  storeCache.clear()
  clearCanonicalEntityNameCache()
  clearRecordRelationsCache()
  clearCrmStorageCache()
  supabaseRecordsStore.clearCache?.()
  hasuraRecordsStore.clearCache?.()
  directusRecordsStore.clearCache?.()
}

export async function resolveRecordsStore(entityApiName: string): Promise<RecordsStore> {
  if (isRegistryPlatformEntity(entityApiName)) {
    refuseRecordsBackend(
      entityApiName,
      'platform entity; use layout / user-setting / recent-views APIs',
    )
  }

  const canonical = await resolveCanonicalEntityApiName(entityApiName)

  const forced = envForceTarget()
  if (forced) return storeForTarget(canonical, forced)

  const allow = envEntityAllowList()
  if (allow?.has(entityApiName) || allow?.has(canonical)) return supabaseRecordsStore
  const cached = storeCache.get(canonical)
  if (cached) return cached

  const rows = await query<{ backend_target: string }>(
    `SELECT backend_target
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [canonical],
  )
  const target = String(rows[0]?.backend_target || 'SUPABASE').toUpperCase()
  const store = storeForTarget(canonical, target)
  storeCache.set(canonical, store)
  setTimeout(() => storeCache.delete(canonical), 30_000)
  return store
}

export async function resolveRecordsBackend(
  entityApiName: string,
): Promise<LiveRecordsBackendId> {
  const store = await resolveRecordsStore(entityApiName)
  return store.id
}
