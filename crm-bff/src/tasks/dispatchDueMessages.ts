/**
 * Dispatch Message outbox rows whose scheduled_send_at is due.
 * Claims rows atomically (queued or stale sending → sending) then triggers
 * dispatch_outbound_message.
 *
 * The idempotency key is ce-message-{id}. The shipped n8n template uses it as
 * the SMTP Message-ID and skips send only when delivery_status is already
 * sent or delivered. A reclaimed sending row is therefore sent again; the
 * attempt cap is what bounds that, not the key.
 */
import { runLocalFlow } from '../flows/localFlows.js'
import {
  claimDueQueuedMessages,
  failExhaustedMessageClaims,
  releaseClaimedMessage,
} from './claimQueuedMessages.js'
import { resolveConnectionKey } from './connectionKey.js'
import { resolveMessageOutboxPolicy } from './messageOutbox.js'

const DEFAULT_CONNECTION_KEY = 'dispatch_outbound_message'
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
  const connectionKey = resolveConnectionKey(params, DEFAULT_CONNECTION_KEY)
  const limit = positiveInt(params.limit, DEFAULT_LIMIT)
  const policy = resolveMessageOutboxPolicy(params)

  const exhausted = await failExhaustedMessageClaims({
    collection,
    staleBeforeIso: policy.staleBeforeIso,
    maxAttempts: policy.maxAttempts,
  })

  const claimed = await claimDueQueuedMessages({
    collection,
    limit,
    nowIso: policy.nowIso,
    staleBeforeIso: policy.staleBeforeIso,
    maxAttempts: policy.maxAttempts,
  })

  let dispatched = 0
  let failed = 0
  let requeued = 0
  const errors: string[] = []

  for (const row of claimed) {
    try {
      await runLocalFlow(
        connectionKey,
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
        const released = await releaseClaimedMessage({
          collection,
          id: row.id,
          maxAttempts: policy.maxAttempts,
        })
        if (released === 'requeued') requeued += 1
      } catch (releaseError) {
        const releaseMessage =
          releaseError instanceof Error ? releaseError.message : String(releaseError)
        errors.push(`${row.id}: release failed: ${releaseMessage}`)
      }
    }
  }

  return {
    collection,
    connectionKey,
    scanned: claimed.length,
    claimed: claimed.length,
    dispatched,
    failed,
    requeued,
    exhausted,
    staleMinutes: policy.staleMinutes,
    maxAttempts: policy.maxAttempts,
    errors: errors.slice(0, 10),
    asOf: policy.nowIso,
  }
}
