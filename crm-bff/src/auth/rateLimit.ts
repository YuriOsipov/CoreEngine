/**
 * Simple in-process fixed-window rate limiter (per key).
 * Good enough for single-node BFF; replace with Redis if you run many replicas.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Hard cap so a flood of unique keys cannot exhaust memory between sweeps. */
const MAX_BUCKETS = 50_000
const SWEEP_INTERVAL_MS = 60_000
let lastSweepAt = 0

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
  lastSweepAt = now
}

function ensureCapacity(now: number): void {
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) sweepExpired(now)
  if (buckets.size < MAX_BUCKETS) return
  sweepExpired(now)
  // Still full of live buckets: evict oldest-inserted (Map keeps insertion order).
  const overflow = buckets.size - MAX_BUCKETS + 1
  let removed = 0
  for (const key of buckets.keys()) {
    if (removed >= overflow) break
    buckets.delete(key)
    removed += 1
  }
}

export function rateLimitConsume(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    if (!existing) ensureCapacity(now)
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }
  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }
  existing.count += 1
  return { ok: true }
}

/** Read-only check: is `key` currently over `limit`? Does not consume. */
export function rateLimitPeek(
  key: string,
  limit: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now || existing.count < limit) return { ok: true }
  return {
    ok: false,
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  }
}

export function rateLimitReset(key: string): void {
  buckets.delete(key)
}

/** Test helper. */
export function clearRateLimitBuckets(): void {
  buckets.clear()
  lastSweepAt = 0
}

/** Test helper. */
export function rateLimitBucketCount(): number {
  return buckets.size
}
