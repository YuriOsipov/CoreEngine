/**
 * Atomically claim due Message outbox rows (queued → sending).
 * Uses FOR UPDATE SKIP LOCKED so two BFF schedulers cannot claim the same row.
 */
import { query } from '../db/pool.js'
import { quoteIdent, resolveRecordRelation } from '../schema/crmStorage.js'

export type ClaimedMessageRow = {
  id: string
  record: Record<string, unknown>
  idempotencyKey: string
}

export function messageIdempotencyKey(messageId: string): string {
  return `ce-message-${String(messageId).trim()}`
}

function asPublicRecord(row: Record<string, unknown>): Record<string, unknown> {
  const data =
    row.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : {}
  const out: Record<string, unknown> = {
    ...data,
    id: String(row.record_id ?? row.id ?? '').trim(),
    delivery_status: 'sending',
  }
  for (const [key, value] of Object.entries(row)) {
    if (key === 'data' || key === 'record_id') continue
    if (value !== null && value !== undefined) out[key] = value
  }
  return out
}

function mapClaimed(rows: Record<string, unknown>[]): ClaimedMessageRow[] {
  return rows
    .map((row) => {
      const id = String(row.record_id || '').trim()
      return {
        id,
        record: asPublicRecord(row),
        idempotencyKey: messageIdempotencyKey(id),
      }
    })
    .filter((row) => row.id)
}

/**
 * Claim up to `limit` due queued messages. Returns only rows this caller owns.
 */
export async function claimDueQueuedMessages(options: {
  collection: string
  limit: number
  nowIso?: string
}): Promise<ClaimedMessageRow[]> {
  const collection = String(options.collection || '').trim()
  if (!collection) return []
  const limit = Math.min(Math.max(Math.floor(options.limit), 1), 200)
  const nowIso = options.nowIso || new Date().toISOString()
  const relation = await resolveRecordRelation(collection)
  const promoted = new Set(relation.promoted.map((field) => field.apiName))
  const deletedClause = relation.hasDeleted
    ? `AND COALESCE(is_deleted, false) = false`
    : ''

  if (relation.storage === 'typed') {
    const statusCol = promoted.has('delivery_status')
      ? `d.${quoteIdent('delivery_status')}`
      : `d.data->>'delivery_status'`
    const statusColM = promoted.has('delivery_status')
      ? `m.${quoteIdent('delivery_status')}`
      : `m.data->>'delivery_status'`
    const draftCol = promoted.has('is_draft')
      ? `d.${quoteIdent('is_draft')}`
      : `d.data->>'is_draft'`
    const scheduledCol = promoted.has('scheduled_send_at')
      ? `d.${quoteIdent('scheduled_send_at')}`
      : `NULLIF(d.data->>'scheduled_send_at', '')`
    const setStatus = promoted.has('delivery_status')
      ? `${quoteIdent('delivery_status')} = 'sending'`
      : `data = jsonb_set(COALESCE(data, '{}'::jsonb), '{delivery_status}', '"sending"'::jsonb, true)`

    const rows = await query<Record<string, unknown>>(
      `WITH due AS (
         SELECT record_id
         FROM ${relation.relationSql} AS d
         WHERE ${statusCol} = 'queued'
           AND COALESCE((${draftCol})::text, 'false') NOT IN ('true', '1', 't')
           AND ${scheduledCol} IS NOT NULL
           AND (${scheduledCol})::timestamptz <= $1::timestamptz
           ${deletedClause}
         ORDER BY (${scheduledCol})::timestamptz ASC NULLS LAST
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE ${relation.relationSql} AS m
       SET ${setStatus},
           updated_at = now()
       FROM due
       WHERE m.record_id = due.record_id
         AND ${statusColM} = 'queued'
       RETURNING m.*`,
      [nowIso, limit],
    )
    return mapClaimed(rows)
  }

  const rows = await query<Record<string, unknown>>(
    `WITH due AS (
       SELECT record_id
       FROM public.business_records AS d
       WHERE d.entity_api_name = $1
         AND COALESCE(d.data->>'delivery_status', '') = 'queued'
         AND COALESCE(d.data->>'is_draft', 'false') NOT IN ('true', '1')
         AND NULLIF(d.data->>'scheduled_send_at', '') IS NOT NULL
         AND (d.data->>'scheduled_send_at')::timestamptz <= $2::timestamptz
         ${deletedClause}
       ORDER BY (d.data->>'scheduled_send_at')::timestamptz ASC NULLS LAST
       FOR UPDATE SKIP LOCKED
       LIMIT $3
     )
     UPDATE public.business_records AS br
     SET data = jsonb_set(COALESCE(br.data, '{}'::jsonb), '{delivery_status}', '"sending"'::jsonb, true),
         updated_at = now()
     FROM due
     WHERE br.record_id = due.record_id
       AND COALESCE(br.data->>'delivery_status', '') = 'queued'
     RETURNING br.*`,
    [collection, nowIso, limit],
  )
  return mapClaimed(rows)
}
