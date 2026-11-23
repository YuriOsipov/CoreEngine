import { pool } from './pool.js'

/**
 * Session-scoped Postgres advisory lock on a dedicated client.
 * Must unlock on the same connection (pool-safe).
 */
export async function withAdvisoryLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const key = String(lockKey || '').trim()
  if (!key) throw new Error('advisory lock key is required')

  const client = await pool.connect()
  try {
    const tried = await client.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok`,
      [key],
    )
    if (!tried.rows[0]?.ok) {
      return { acquired: false }
    }
    try {
      const value = await fn()
      return { acquired: true, value }
    } finally {
      try {
        await client.query(
          `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
          [key],
        )
      } catch (error) {
        console.warn('[advisoryLock] unlock failed', error)
      }
    }
  } finally {
    client.release()
  }
}

/** Stable lock namespace for scheduled tasks. */
export function scheduledTaskLockKey(taskId: string): string {
  return `ce:scheduled_task:${String(taskId).trim()}`
}
