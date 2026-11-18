/**
 * Shared DB-backed epoch counters so Setup cache clears on one BFF instance
 * invalidate peers without waiting for the in-memory TTL.
 */
import { query } from '../db/pool.js'

export type CacheEpochName = 'field_security' | 'row_level_security'

const localEpoch = new Map<CacheEpochName, number>()

export async function readCacheEpoch(name: CacheEpochName): Promise<number> {
  try {
    const rows = await query<{ epoch: string | number }>(
      `SELECT epoch FROM public.app_cache_epochs WHERE name = $1 LIMIT 1`,
      [name],
    )
    const raw = Array.isArray(rows) ? rows[0]?.epoch : undefined
    const n = typeof raw === 'number' ? raw : Number(raw)
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1
  } catch (error) {
    // Pre-migration / missing table — fall back to local-only caching.
    console.warn(`[cacheEpoch] read ${name} failed`, error)
    return localEpoch.get(name) ?? 1
  }
}

export async function bumpCacheEpoch(name: CacheEpochName): Promise<number> {
  try {
    const rows = await query<{ epoch: string | number }>(
      `INSERT INTO public.app_cache_epochs (name, epoch, updated_at)
       VALUES ($1, 1, now())
       ON CONFLICT (name) DO UPDATE
         SET epoch = public.app_cache_epochs.epoch + 1,
             updated_at = now()
       RETURNING epoch`,
      [name],
    )
    const raw = Array.isArray(rows) ? rows[0]?.epoch : undefined
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`cache epoch upsert for ${name} returned no row`)
    }
    const next = Math.trunc(n)
    localEpoch.set(name, next)
    return next
  } catch (error) {
    const next = (localEpoch.get(name) ?? 1) + 1
    localEpoch.set(name, next)
    console.warn(`[cacheEpoch] bump ${name} failed; local epoch=${next}`, error)
    return next
  }
}

/** Test helper */
export function resetLocalCacheEpochsForTests(): void {
  localEpoch.clear()
}
