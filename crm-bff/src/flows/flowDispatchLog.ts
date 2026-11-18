import { query } from '../db/pool.js'
import { scheduleFailedRunNotify } from '../ops/failedRunNotify.js'

const ERROR_MAX = 4000
const KEY_MAX = 200

export interface FlowDispatchContext {
  source: string
  collection: string | null
  recordId: string | null
}

export interface FlowDispatchRow {
  id: string
  flowKey: string
  source: string
  status: string
  collection: string | null
  recordId: string | null
  error: string | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Source / record hints from a flow payload (including `{ body: { ... } }` webhook wrappers). */
export function flowDispatchContext(payload: unknown): FlowDispatchContext {
  const body = asRecord(payload)
  const nested = asRecord(body?.body)
  const source = pickString(body?.source) || pickString(nested?.source) || 'flow'
  const collection = pickString(body?.collection) || pickString(nested?.collection)
  const recordId = pickString(body?.recordId) || pickString(nested?.recordId)
  return {
    source: source.slice(0, 80),
    collection: collection ? collection.slice(0, 120) : null,
    recordId: recordId ? recordId.slice(0, 120) : null,
  }
}

function iso(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function mapRow(row: Record<string, unknown>): FlowDispatchRow {
  return {
    id: String(row.id),
    flowKey: String(row.flow_key),
    source: String(row.source),
    status: String(row.status),
    collection: row.collection == null ? null : String(row.collection),
    recordId: row.record_id == null ? null : String(row.record_id),
    error: row.error == null ? null : String(row.error),
    startedAt: iso(row.started_at) || new Date().toISOString(),
    finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at) || new Date().toISOString(),
  }
}

function isMissingDispatchTable(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    if ((error as { code?: string }).code === '42P01') return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /app_flow_dispatches/i.test(message) && /does not exist/i.test(message)
}

/** Persist a failed flow attempt. Never throws — logging must not hide the original error. */
export async function recordFlowDispatchFailure(input: {
  flowKey: string
  source: string
  collection: string | null
  recordId: string | null
  error: string
  startedAt: Date
  finishedAt: Date
}): Promise<void> {
  try {
    await query(
      `WITH pruned AS (
         DELETE FROM public.app_flow_dispatches
         WHERE status = 'error'
           AND created_at < now() - interval '90 days'
       )
       INSERT INTO public.app_flow_dispatches
         (flow_key, source, status, collection, record_id, error, started_at, finished_at)
       VALUES ($1, $2, 'error', $3, $4, $5, $6, $7)`,
      [
        input.flowKey.slice(0, KEY_MAX) || '(missing)',
        input.source.slice(0, 80) || 'flow',
        input.collection,
        input.recordId,
        input.error.slice(0, ERROR_MAX),
        input.startedAt,
        input.finishedAt,
      ],
    )
    const detailParts = [
      input.source ? `source=${input.source}` : '',
      input.collection ? `collection=${input.collection}` : '',
      input.recordId ? `recordId=${input.recordId}` : '',
    ].filter(Boolean)
    scheduleFailedRunNotify({
      kind: 'flow',
      key: input.flowKey.slice(0, KEY_MAX) || '(missing)',
      error: input.error.slice(0, ERROR_MAX),
      detail: detailParts.join(' '),
    })
  } catch (error) {
    if (isMissingDispatchTable(error)) return
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[flowDispatch] failed to record flow error:', message)
  }
}

export async function listFailedFlowDispatches(limit = 50): Promise<FlowDispatchRow[]> {
  const capped = Math.min(Math.max(limit, 1), 100)
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT *
       FROM public.app_flow_dispatches
       WHERE status = 'error'
       ORDER BY created_at DESC
       LIMIT $1`,
      [capped],
    )
    return rows.map(mapRow)
  } catch (error) {
    if (isMissingDispatchTable(error)) return []
    throw error
  }
}
