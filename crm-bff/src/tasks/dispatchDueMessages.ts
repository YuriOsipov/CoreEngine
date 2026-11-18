/**
 * Dispatch Message outbox rows whose scheduled_send_at is due.
 * Sets delivery_status=sending then triggers dispatch_outbound_message (n8n).
 */
import {
  findManyRecords,
  SYSTEM_RECORD_ACCESS,
  updateRecord,
} from '../adapters/records/facade.js'
import { runLocalFlow } from '../flows/localFlows.js'

const DEFAULT_FLOW_KEY = 'dispatch_outbound_message'
const DEFAULT_COLLECTION = 'message'
const DEFAULT_LIMIT = 50

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), 200)
}

export async function dispatchDueMessages(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collection =
    (typeof params.collection === 'string' && params.collection.trim()) ||
    DEFAULT_COLLECTION
  const flowKey =
    (typeof params.flowKey === 'string' && params.flowKey.trim()) ||
    DEFAULT_FLOW_KEY
  const limit = positiveInt(params.limit, DEFAULT_LIMIT)
  const nowIso = new Date().toISOString()

  const { nodes } = await findManyRecords(collection, {
    filter: {
      _and: [
        { delivery_status: { _eq: 'queued' } },
        { result: { _null: true } },
        { is_active: { _eq: true } },
        { scheduled_send_at: { _nnull: true } },
        { scheduled_send_at: { _lte: nowIso } },
      ],
    },
    limit,
    offset: 0,
    sort: ['scheduled_send_at'],
    access: SYSTEM_RECORD_ACCESS,
  })

  let dispatched = 0
  let failed = 0
  const errors: string[] = []

  for (const raw of nodes) {
    const record = asObject(raw)
    const recordId = String(record.id || '').trim()
    if (!recordId) continue

    try {
      await updateRecord(
        collection,
        recordId,
        { delivery_status: 'sending' },
        { access: SYSTEM_RECORD_ACCESS },
      )
      await runLocalFlow(
        flowKey,
        {
          source: 'scheduled_task',
          trigger: 'dispatch_due_messages',
          collection,
          recordId,
          record: { ...record, delivery_status: 'sending' },
        },
        { kind: 'system' },
      )
      dispatched += 1
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${recordId}: ${message}`)
      try {
        await updateRecord(
          collection,
          recordId,
          { delivery_status: 'queued' },
          { access: SYSTEM_RECORD_ACCESS },
        )
      } catch {
        // leave as sending if revert fails — operator can fix in UI
      }
    }
  }

  return {
    collection,
    flowKey,
    scanned: nodes.length,
    dispatched,
    failed,
    errors: errors.slice(0, 10),
    asOf: nowIso,
  }
}
