import { query } from '../db/pool.js'
import { scheduleFailedRunNotify } from '../ops/failedRunNotify.js'
import { sanitizeFlowErrorMessage } from './flowErrorSanitize.js'

const ERROR_MAX = 4000
const KEY_MAX = 200
const REQUEST_BODY_MAX = 8000
/** When config.debug is on, keep this many recent rows per flow_key (success + error). */
export const FLOW_DEBUG_KEEP = 50

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
  httpStatus: number | null
  requestBody: string | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

/** Truncate a JSON payload for storage in app_flow_dispatches.request_body. */
export function truncateFlowRequestBody(value: unknown, max = REQUEST_BODY_MAX): string | null {
  try {
    const text = JSON.stringify(value ?? {})
    if (!text || text === '{}' || text === 'null') return text === '{}' ? '{}' : null
    if (text.length <= max) return text
    return `${text.slice(0, max)}…`
  } catch {
    return null
  }
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** True when Setup → External Flows has Log recent runs enabled. */
export function flowDebugRequested(
  config: { debug?: unknown } | null | undefined,
): boolean {
  if (!config) return false
  return (
    config.debug === true ||
    String(config.debug || '')
      .trim()
      .toLowerCase() === 'true'
  )
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
  const httpRaw = row.http_status
  const httpStatus =
    typeof httpRaw === 'number' && Number.isFinite(httpRaw)
      ? httpRaw
      : typeof httpRaw === 'string' && httpRaw.trim() && Number.isFinite(Number(httpRaw))
        ? Number(httpRaw)
        : null
  return {
    id: String(row.id),
    flowKey: String(row.flow_key),
    source: String(row.source),
    status: String(row.status),
    collection: row.collection == null ? null : String(row.collection),
    recordId: row.record_id == null ? null : String(row.record_id),
    error: row.error == null ? null : String(row.error),
    httpStatus,
    requestBody: row.request_body == null ? null : String(row.request_body),
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

async function pruneDebugRuns(flowKey: string): Promise<void> {
  await query(
    `DELETE FROM public.app_flow_dispatches
     WHERE flow_key = $1
       AND id NOT IN (
         SELECT id
         FROM public.app_flow_dispatches
         WHERE flow_key = $1
         ORDER BY created_at DESC
         LIMIT $2
       )`,
    [flowKey.slice(0, KEY_MAX), FLOW_DEBUG_KEEP],
  )
}

/**
 * Persist a flow attempt. Never throws — logging must not hide the original outcome.
 * - error: always stored; 90-day prune when not debugging; last-N prune when debug
 * - success: only when debug; last-N prune per flow_key
 */
export async function recordFlowDispatch(input: {
  flowKey: string
  source: string
  collection: string | null
  recordId: string | null
  status: 'error' | 'success'
  error?: string | null
  httpStatus?: number | null
  requestBody?: string | null
  startedAt: Date
  finishedAt: Date
  debug?: boolean
}): Promise<void> {
  const status = input.status
  const debug = Boolean(input.debug)
  if (status === 'success' && !debug) return

  const flowKey = input.flowKey.slice(0, KEY_MAX) || '(missing)'
  const errorText =
    status === 'error'
      ? sanitizeFlowErrorMessage(String(input.error || 'unknown error')).slice(
          0,
          ERROR_MAX,
        )
      : null
  const httpStatus =
    typeof input.httpStatus === 'number' && Number.isFinite(input.httpStatus)
      ? Math.trunc(input.httpStatus)
      : null
  const requestBody =
    typeof input.requestBody === 'string' && input.requestBody
      ? input.requestBody.slice(0, REQUEST_BODY_MAX + 1)
      : null

  try {
    if (debug) {
      await query(
        `INSERT INTO public.app_flow_dispatches
           (flow_key, source, status, collection, record_id, error, http_status, request_body, started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          flowKey,
          input.source.slice(0, 80) || 'flow',
          status,
          input.collection,
          input.recordId,
          errorText,
          httpStatus,
          requestBody,
          input.startedAt,
          input.finishedAt,
        ],
      )
      await pruneDebugRuns(flowKey)
    } else {
      await query(
        `WITH pruned AS (
           DELETE FROM public.app_flow_dispatches
           WHERE status = 'error'
             AND created_at < now() - interval '90 days'
         )
         INSERT INTO public.app_flow_dispatches
           (flow_key, source, status, collection, record_id, error, http_status, request_body, started_at, finished_at)
         VALUES ($1, $2, 'error', $3, $4, $5, $6, $7, $8, $9)`,
        [
          flowKey,
          input.source.slice(0, 80) || 'flow',
          input.collection,
          input.recordId,
          errorText,
          httpStatus,
          requestBody,
          input.startedAt,
          input.finishedAt,
        ],
      )
    }

    if (status === 'error') {
      const detailParts = [
        input.source ? `source=${input.source}` : '',
        input.collection ? `collection=${input.collection}` : '',
        input.recordId ? `recordId=${input.recordId}` : '',
      ].filter(Boolean)
      scheduleFailedRunNotify({
        kind: 'flow',
        key: flowKey,
        error: errorText || 'unknown error',
        detail: detailParts.join(' '),
      })
    }
  } catch (error) {
    if (isMissingDispatchTable(error)) return
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[flowDispatch] failed to record flow run:', message)
  }
}

/** Persist a failed flow attempt (always). Prefer {@link recordFlowDispatch}. */
export async function recordFlowDispatchFailure(input: {
  flowKey: string
  source: string
  collection: string | null
  recordId: string | null
  error: string
  startedAt: Date
  finishedAt: Date
  debug?: boolean
}): Promise<void> {
  await recordFlowDispatch({
    ...input,
    status: 'error',
  })
}

/** Drop success rows when an admin turns debug off for a key. */
export async function clearFlowDispatchSuccesses(flowKey: string): Promise<void> {
  const key = flowKey.trim().slice(0, KEY_MAX)
  if (!key) return
  try {
    await query(
      `DELETE FROM public.app_flow_dispatches
       WHERE flow_key = $1 AND status = 'success'`,
      [key],
    )
  } catch (error) {
    if (isMissingDispatchTable(error)) return
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[flowDispatch] failed to clear success runs:', message)
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

/** Recent runs (errors always; successes only exist when a flow had debug on). */
export async function listFlowDispatches(input?: {
  limit?: number | null
  flowKey?: string | null
}): Promise<FlowDispatchRow[]> {
  const capped = Math.min(Math.max(input?.limit ?? 50, 1), 100)
  const flowKey = String(input?.flowKey || '')
    .trim()
    .slice(0, KEY_MAX)
  try {
    const rows = flowKey
      ? await query<Record<string, unknown>>(
          `SELECT *
           FROM public.app_flow_dispatches
           WHERE flow_key = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [flowKey, capped],
        )
      : await query<Record<string, unknown>>(
          `SELECT *
           FROM public.app_flow_dispatches
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
