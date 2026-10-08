import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'

export interface RecentRecordViewRow {
  id: string
  userId: string
  collection: string
  recordId: string
  viewedAt: string
}

export async function upsertRecentRecordView(options: {
  userId: string
  collection: string
  recordId: string
  viewedAt?: string | null
}): Promise<RecentRecordViewRow> {
  const viewedAt = options.viewedAt || new Date().toISOString()
  // Pass id from Node — column default extensions.gen_random_uuid() is blocked
  // by WDAC on some Windows hosts (same pattern as app_refresh_tokens).
  const rows = await query<{
    id: string
    user_id: string
    collection: string
    record_id: string
    viewed_at: string
  }>(
    `INSERT INTO public.recent_record_views (
       id, user_id, collection, record_id, viewed_at
     ) VALUES ($1::uuid, $2, $3, $4, $5::timestamptz)
     ON CONFLICT (user_id, collection, record_id) DO UPDATE SET
       viewed_at = EXCLUDED.viewed_at,
       updated_at = now()
     RETURNING
       id::text AS id,
       user_id,
       collection,
       record_id,
       viewed_at::text AS viewed_at`,
    [randomUUID(), options.userId, options.collection, options.recordId, viewedAt],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to upsert recent record view')
  return {
    id: row.id,
    userId: row.user_id,
    collection: row.collection,
    recordId: row.record_id,
    viewedAt: row.viewed_at,
  }
}

export async function listRecentRecordViews(options: {
  userId: string
  collection: string
  limit?: number
  offset?: number
}): Promise<{ views: RecentRecordViewRow[]; totalCount: number }> {
  const limit = Math.max(0, Math.min(options.limit ?? 100, 500))
  const offset = Math.max(0, options.offset ?? 0)

  const [views, countRows] = await Promise.all([
    query<{
      id: string
      user_id: string
      collection: string
      record_id: string
      viewed_at: string
    }>(
      `SELECT
         id::text AS id,
         user_id,
         collection,
         record_id,
         viewed_at::text AS viewed_at
       FROM public.recent_record_views
       WHERE user_id = $1
         AND collection = $2
       ORDER BY viewed_at DESC
       LIMIT $3 OFFSET $4`,
      [options.userId, options.collection, limit, offset],
    ),
    query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.recent_record_views
       WHERE user_id = $1
         AND collection = $2`,
      [options.userId, options.collection],
    ),
  ])

  return {
    views: views.map((row) => ({
      id: row.id,
      userId: row.user_id,
      collection: row.collection,
      recordId: row.record_id,
      viewedAt: row.viewed_at,
    })),
    totalCount: Number(countRows[0]?.count ?? 0),
  }
}

export const RECENT_VIEW_DEFAULT_RETENTION_DAYS = 90
export const RECENT_VIEW_DEFAULT_MAX_PER_USER_COLLECTION = 200

export interface MaintainRecentRecordViewsResult {
  retentionDays: number
  maxPerUserCollection: number
  deletedExpired: number
  deletedOverLimit: number
  deletedTotal: number
}

/**
 * Periodic maintenance for Recently Viewed:
 * - drop rows older than `retentionDays`
 * - keep at most `maxPerUserCollection` rows per (user_id, collection)
 */
export async function maintainRecentRecordViews(options?: {
  retentionDays?: number
  maxPerUserCollection?: number
}): Promise<MaintainRecentRecordViewsResult> {
  const retentionDays = Math.max(
    1,
    Math.floor(
      Number(options?.retentionDays) || RECENT_VIEW_DEFAULT_RETENTION_DAYS,
    ),
  )
  const maxPerUserCollection = Math.max(
    1,
    Math.floor(
      Number(options?.maxPerUserCollection) ||
        RECENT_VIEW_DEFAULT_MAX_PER_USER_COLLECTION,
    ),
  )

  const expired = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM public.recent_record_views
       WHERE viewed_at < now() - ($1::int * interval '1 day')
       RETURNING 1
     )
     SELECT count(*)::text AS count FROM deleted`,
    [retentionDays],
  )

  const overLimit = await query<{ count: string }>(
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY user_id, collection
                ORDER BY viewed_at DESC, id DESC
              ) AS rn
       FROM public.recent_record_views
     ),
     deleted AS (
       DELETE FROM public.recent_record_views r
       USING ranked
       WHERE r.id = ranked.id
         AND ranked.rn > $1
       RETURNING 1
     )
     SELECT count(*)::text AS count FROM deleted`,
    [maxPerUserCollection],
  )

  const deletedExpired = Number(expired[0]?.count ?? 0)
  const deletedOverLimit = Number(overLimit[0]?.count ?? 0)
  return {
    retentionDays,
    maxPerUserCollection,
    deletedExpired,
    deletedOverLimit,
    deletedTotal: deletedExpired + deletedOverLimit,
  }
}
