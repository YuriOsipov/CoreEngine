import { beforeEach, describe, expect, it, vi } from 'vitest'

const assertMeEntityPermission = vi.fn()

vi.mock('../services/rolePermissions.js', () => ({
  assertMeEntityPermission: (...args: unknown[]) => assertMeEntityPermission(...args),
}))

import {
  assertIncludeDeletedAllowed,
  MAX_EXPORT_LIMIT,
  MAX_READ_LIMIT,
  resolveAuthorizedListLimit,
} from './listQueryPolicy.js'

const me = { id: 'u1', adminAccess: false, roleAdminAccess: false } as const

describe('listQueryPolicy', () => {
  beforeEach(() => {
    assertMeEntityPermission.mockReset()
    assertMeEntityPermission.mockResolvedValue(me)
  })

  it('allows ordinary limits without export', async () => {
    await expect(
      resolveAuthorizedListLimit(me as never, 'opportunity', 100),
    ).resolves.toBe(100)
    expect(assertMeEntityPermission).not.toHaveBeenCalled()
  })

  it('requires export for oversize or unlimited limits', async () => {
    await expect(
      resolveAuthorizedListLimit(me as never, 'opportunity', MAX_READ_LIMIT + 1),
    ).resolves.toBe(MAX_READ_LIMIT + 1)
    await expect(
      resolveAuthorizedListLimit(me as never, 'opportunity', -1),
    ).resolves.toBe(MAX_EXPORT_LIMIT)
    expect(assertMeEntityPermission.mock.calls.map((c) => c[2])).toEqual([
      'export',
      'export',
    ])
  })

  it('requires export for includeDeleted', async () => {
    await assertIncludeDeletedAllowed(me as never, 'opportunity', true)
    expect(assertMeEntityPermission).toHaveBeenCalledWith(me, 'opportunity', 'export')
    assertMeEntityPermission.mockClear()
    await assertIncludeDeletedAllowed(me as never, 'opportunity', false)
    expect(assertMeEntityPermission).not.toHaveBeenCalled()
  })
})
