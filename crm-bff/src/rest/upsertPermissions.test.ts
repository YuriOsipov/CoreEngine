import { beforeEach, describe, expect, it, vi } from 'vitest'

const assertMeEntityPermission = vi.fn()

vi.mock('../services/rolePermissions.js', () => ({
  assertMeEntityPermission: (...args: unknown[]) => assertMeEntityPermission(...args),
}))

import { assertUpsertPermissions } from './upsertPermissions.js'

const me = { id: 'u1' } as const

describe('assertUpsertPermissions', () => {
  beforeEach(() => {
    assertMeEntityPermission.mockReset()
    assertMeEntityPermission.mockResolvedValue(me)
  })

  it('checks create then update before any caller DB probe', async () => {
    await assertUpsertPermissions(me as never, 'opportunity')
    expect(assertMeEntityPermission.mock.calls.map((call) => call[2])).toEqual([
      'create',
      'update',
    ])
  })

  it('fails closed on create denial without checking update', async () => {
    assertMeEntityPermission.mockRejectedValueOnce(
      new Error('Permission denied: create on opportunity'),
    )
    await expect(
      assertUpsertPermissions(me as never, 'opportunity'),
    ).rejects.toThrow('Permission denied: create on opportunity')
    expect(assertMeEntityPermission).toHaveBeenCalledTimes(1)
  })
})
