import { beforeEach, describe, expect, it, vi } from 'vitest'

const runLocalFlow = vi.fn()

vi.mock('../flows/localFlows.js', () => ({
  runLocalFlow: (...args: unknown[]) => runLocalFlow(...args),
}))

vi.mock('../schedule/generateSlots.js', () => ({
  generateScheduleSlots: vi.fn(),
}))
vi.mock('../services/recentRecordsService.js', () => ({
  maintainRecentRecordViews: vi.fn(),
}))
vi.mock('../sync/schemaSyncService.js', () => ({
  runSchemaDriftCheck: vi.fn(),
}))
vi.mock('./dispatchDueMessages.js', () => ({
  dispatchDueMessages: vi.fn(),
}))
vi.mock('./purgeArchivedRecords.js', () => ({
  purgeArchivedRecords: vi.fn(),
}))

import { executeJobType, isJobType } from './jobTypes.js'

describe('call_connection job type', () => {
  beforeEach(() => {
    runLocalFlow.mockReset()
    runLocalFlow.mockResolvedValue({ ok: true, handler: 'http' })
  })

  it('registers call_connection and keeps send_notification alias', () => {
    expect(isJobType('call_connection')).toBe(true)
    expect(isJobType('send_notification')).toBe(true)
    expect(isJobType('sync_promo_prices')).toBe(false)
  })

  it('runs connection with payload and injects timeZone', async () => {
    const result = await executeJobType(
      'call_connection',
      { connectionKey: 'sync_promo_prices', payload: { dryRun: true } },
      'Europe/Kyiv',
    )
    expect(runLocalFlow).toHaveBeenCalledWith(
      'sync_promo_prices',
      { dryRun: true, timeZone: 'Europe/Kyiv' },
    )
    expect(result).toMatchObject({ connectionKey: 'sync_promo_prices', ok: true })
  })

  it('send_notification alias still works', async () => {
    await executeJobType('send_notification', { flowKey: 'legacy_key', payload: {} }, 'UTC')
    expect(runLocalFlow).toHaveBeenCalledWith('legacy_key', { timeZone: 'UTC' })
  })

  it('requires connectionKey', async () => {
    await expect(executeJobType('call_connection', {}, 'UTC')).rejects.toThrow(
      /connectionKey/,
    )
  })
})
