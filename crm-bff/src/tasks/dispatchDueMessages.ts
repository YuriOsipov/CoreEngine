/**
 * Dispatch Message outbox rows whose scheduled_send_at is due.
 * Claims rows atomically (queued → sending) then triggers dispatch_outbound_message.
 */
import {
  SYSTEM_RECORD_ACCESS,
  updateRecord,
} from '../adapters/records/facade.js'
import { runLocalFlow } from '../flows/localFlows.js'
import { claimDueQueuedMessages } from './claimQueuedMessages.js'

const DEFAULT_FLOW_KEY = 'dispatch_outbound_message'
const DEFAULT_COLLECTION = 'message'
const DEFAULT_LIMIT = 50

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

  const claimed = await claimDueQueuedMessages({
    collection,
    limit,
    nowIso,
  })

  let dispatched = 0
  let failed = 0
  const errors: string[] = []

  for (const row of claimed) {
    try {
      await runLocalFlow(
        flowKey,
        {
          source: 'scheduled_task',
          trigger: 'dispatch_due_messages',
          collection,
          recordId: row.id,
          idempotencyKey: row.idempotencyKey,
          record: { ...row.record, delivery_status: 'sending' },
        },
        { kind: 'system' },
      )
      dispatched += 1
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${row.id}: ${message}`)
      try {
        await updateRecord(
          collection,
          row.id,
          { delivery_status: 'queued' },
          null,
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
    scanned: claimed.length,
    claimed: claimed.length,
    dispatched,
    failed,
    errors: errors.slice(0, 10),
    asOf: nowIso,
  }
}
