import { describe, expect, it, vi } from 'vitest'

const connect = vi.fn()
vi.mock('./pool.js', () => ({
  pool: { connect: (...args: unknown[]) => connect(...args) },
}))

import { scheduledTaskLockKey, withAdvisoryLock } from './advisoryLock.js'

describe('withAdvisoryLock', () => {
  it('runs work when pg_try_advisory_lock succeeds and unlocks', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ ok: true }] })
      .mockResolvedValueOnce({ rows: [{ ok: true }] })
    const release = vi.fn()
    connect.mockResolvedValue({ query, release })

    const result = await withAdvisoryLock('ce:test', async () => 'done')
    expect(result).toEqual({ acquired: true, value: 'done' })
    expect(query).toHaveBeenCalledTimes(2)
    expect(String(query.mock.calls[0]?.[0])).toMatch(/pg_try_advisory_lock/)
    expect(String(query.mock.calls[1]?.[0])).toMatch(/pg_advisory_unlock/)
    expect(release).toHaveBeenCalled()
  })

  it('skips work when the lock is held', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ok: false }] })
    const release = vi.fn()
    connect.mockResolvedValue({ query, release })
    const work = vi.fn()

    const result = await withAdvisoryLock('ce:test', async () => {
      work()
      return 'nope'
    })
    expect(result).toEqual({ acquired: false })
    expect(work).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalled()
  })
})

describe('scheduledTaskLockKey', () => {
  it('namespaces task ids', () => {
    expect(scheduledTaskLockKey(' abc ')).toBe('ce:scheduled_task:abc')
  })
})
