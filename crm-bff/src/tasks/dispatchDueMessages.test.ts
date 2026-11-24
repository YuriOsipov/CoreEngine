import { beforeEach, describe, expect, it, vi } from 'vitest'

const claimDueQueuedMessages = vi.fn()
const failExhaustedMessageClaims = vi.fn()
const releaseClaimedMessage = vi.fn()
const runLocalFlow = vi.fn()

vi.mock('./claimQueuedMessages.js', () => ({
  claimDueQueuedMessages: (...args: unknown[]) => claimDueQueuedMessages(...args),
  failExhaustedMessageClaims: (...args: unknown[]) => failExhaustedMessageClaims(...args),
  releaseClaimedMessage: (...args: unknown[]) => releaseClaimedMessage(...args),
}))

vi.mock('../flows/localFlows.js', () => ({
  runLocalFlow: (...args: unknown[]) => runLocalFlow(...args),
}))

import { dispatchDueMessages } from './dispatchDueMessages.js'

describe('dispatchDueMessages', () => {
  beforeEach(() => {
    claimDueQueuedMessages.mockReset()
    failExhaustedMessageClaims.mockReset()
    releaseClaimedMessage.mockReset()
    runLocalFlow.mockReset()
    failExhaustedMessageClaims.mockResolvedValue(0)
    claimDueQueuedMessages.mockResolvedValue([])
  })

  it('reclaims nothing and does not release a successful send', async () => {
    claimDueQueuedMessages.mockResolvedValue([
      {
        id: 'm1',
        attempts: 1,
        idempotencyKey: 'ce-message-m1',
        record: { id: 'm1', delivery_status: 'sending', attempts: 1 },
      },
    ])
    runLocalFlow.mockResolvedValue({ ok: true })

    const result = await dispatchDueMessages({ limit: 10, maxAttempts: 5, staleMinutes: 15 })

    expect(failExhaustedMessageClaims).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'message', maxAttempts: 5 }),
    )
    expect(claimDueQueuedMessages).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'message', limit: 10, maxAttempts: 5 }),
    )
    expect(runLocalFlow).toHaveBeenCalledWith(
      'dispatch_outbound_message',
      expect.objectContaining({
        recordId: 'm1',
        idempotencyKey: 'ce-message-m1',
      }),
      { kind: 'system' },
    )
    expect(releaseClaimedMessage).not.toHaveBeenCalled()
    expect(result).toMatchObject({ dispatched: 1, failed: 0, requeued: 0, exhausted: 0 })
  })

  it('releases a thrown send instead of forcing queued', async () => {
    failExhaustedMessageClaims.mockResolvedValue(2)
    claimDueQueuedMessages.mockResolvedValue([
      {
        id: 'm2',
        attempts: 2,
        idempotencyKey: 'ce-message-m2',
        record: { id: 'm2' },
      },
    ])
    runLocalFlow.mockRejectedValue(new Error('smtp down'))
    releaseClaimedMessage.mockResolvedValue('requeued')

    const result = await dispatchDueMessages({})

    expect(releaseClaimedMessage).toHaveBeenCalledWith({
      collection: 'message',
      id: 'm2',
      maxAttempts: 5,
    })
    expect(result).toMatchObject({
      dispatched: 0,
      failed: 1,
      requeued: 1,
      exhausted: 2,
    })
    expect(result.errors).toEqual(['m2: smtp down'])
  })

  it('keeps going when the release itself throws', async () => {
    claimDueQueuedMessages.mockResolvedValue([
      { id: 'm3', attempts: 5, idempotencyKey: 'ce-message-m3', record: { id: 'm3' } },
    ])
    runLocalFlow.mockRejectedValue(new Error('boom'))
    releaseClaimedMessage.mockRejectedValue(new Error('db'))

    const result = await dispatchDueMessages({})

    expect(result.failed).toBe(1)
    expect(result.requeued).toBe(0)
    expect(result.errors).toEqual(['m3: boom', 'm3: release failed: db'])
  })
})
