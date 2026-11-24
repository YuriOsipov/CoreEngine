/**
 * Atomically claim due Message outbox rows (queued or stale sending → sending).
 * Uses FOR UPDATE SKIP LOCKED so two BFF schedulers cannot claim the same row.
 *
 * sending_since is the claim clock. attempts increments on every claim.
 * A row left in sending (process died after the claim) is reclaimed once
 * sending_since is older than the stale window, until attempts hits the cap.
 */
import { query } from '../db/pool.js'
import { resolveRecordRelation } from '../schema/crmStorage.js'
import {
  buildMessageOutboxSql,
  readAttempts,
  type MessageOutboxSql,
} from './messageOutbox.js'

export type ClaimedMessageRow = {
  id: string
  record: Record<string, unknown>
  idempotencyKey: string
  attempts: number
}

export type ReleasedClaim = 'requeued' | 'failed' | 'unchanged'

export function messageIdempotencyKey(messageId: string): string {
  return `ce-message-${String(messageId).trim()}`
}

type OutboxTarget = {
  storage: 'typed' | 'jsonb'
  sql: MessageOutboxSql
}

async function loadOutboxTarget(collection: string): Promise<OutboxTarget | null> {
  const name = String(collection || '').trim()
  if (!name) return null
  const relation = await resolveRecordRelation(name)
  return {
    storage: relation.storage,
    sql: buildMessageOutboxSql({
      storage: relation.storage,
      relationSql: relation.relationSql,
      promoted: relation.promoted.map((field) => field.apiName),
      hasDeleted: relation.hasDeleted,
    }),
  }
}

function asPublicRecord(row: Record<string, unknown>, nowIso: string): Record<string, unknown> {
  const data =
    row.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : {}
  const out: Record<string, unknown> = {
    ...data,
    id: String(row.record_id ?? row.id ?? '').trim(),
    delivery_status: 'sending',
    sending_since: nowIso,
  }
  for (const [key, value] of Object.entries(row)) {
    if (key === 'data' || key === 'record_id') continue
    if (value !== null && value !== undefined) out[key] = value
  }
  if (out.sending_since == null || out.sending_since === '') out.sending_since = nowIso
  return out
}

function mapClaimed(rows: Record<string, unknown>[], nowIso: string): ClaimedMessageRow[] {
  return rows
    .map((row) => {
      const record = asPublicRecord(row, nowIso)
      const id = String(record.id || '').trim()
      return {
        id,
        record,
        idempotencyKey: messageIdempotencyKey(id),
        attempts: readAttempts(record.attempts),
      }
    })
    .filter((row) => row.id)
}

function readStatus(row: Record<string, unknown>): string {
  if (typeof row.delivery_status === 'string' && row.delivery_status.trim()) {
    return row.delivery_status.trim()
  }
  const data = row.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const value = (data as Record<string, unknown>).delivery_status
    if (typeof value === 'string') return value.trim()
  }
  return ''
}

/**
 * Mark stale sending rows that already used every attempt as failed.
 * In-flight claims (sending_since inside the window) are left alone.
 */
export async function failExhaustedMessageClaims(options: {
  collection: string
  staleBeforeIso: string
  maxAttempts: number
}): Promise<number> {
  const target = await loadOutboxTarget(options.collection)
  if (!target) return 0
  const params =
    target.storage === 'jsonb'
      ? [options.collection, options.staleBeforeIso, options.maxAttempts]
      : [options.staleBeforeIso, options.maxAttempts]
  const rows = await query<{ record_id: string }>(target.sql.exhaustSql, params)
  return rows.length
}

/**
 * Claim up to `limit` due rows. Includes queued rows whose backoff has elapsed
 * and sending rows older than the stale window. Returns only rows this caller owns.
 */
export async function claimDueQueuedMessages(options: {
  collection: string
  limit: number
  nowIso: string
  staleBeforeIso: string
  maxAttempts: number
}): Promise<ClaimedMessageRow[]> {
  const collection = String(options.collection || '').trim()
  const target = await loadOutboxTarget(collection)
  if (!target) return []
  const limit = Math.min(Math.max(Math.floor(options.limit), 1), 200)
  const params =
    target.storage === 'jsonb'
      ? [collection, options.nowIso, options.staleBeforeIso, options.maxAttempts, limit]
      : [options.nowIso, options.staleBeforeIso, options.maxAttempts, limit]
  const rows = await query<Record<string, unknown>>(target.sql.claimSql, params)
  return mapClaimed(rows, options.nowIso)
}

/**
 * Put a claimed row back after the flow throws.
 * sent/delivered are left alone (the send already committed).
 * failed + attempts at the cap stays failed.
 * Otherwise: queued while attempts remain, failed once the cap is reached.
 * sending_since is kept so the next claim waits out the stale window.
 */
export async function releaseClaimedMessage(options: {
  collection: string
  id: string
  maxAttempts: number
}): Promise<ReleasedClaim> {
  const id = String(options.id || '').trim()
  const target = await loadOutboxTarget(options.collection)
  if (!target || !id) return 'unchanged'
  const params =
    target.storage === 'jsonb'
      ? [options.collection, id, options.maxAttempts]
      : [id, options.maxAttempts]
  const rows = await query<Record<string, unknown>>(target.sql.releaseSql, params)
  const row = rows[0]
  if (!row) return 'unchanged'
  return readStatus(row) === 'failed' ? 'failed' : 'requeued'
}
