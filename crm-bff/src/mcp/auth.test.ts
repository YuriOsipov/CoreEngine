import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdminAccess = vi.fn()
const requireAuthenticatedUser = vi.fn()

vi.mock('../auth/accessGuards.js', () => ({
  requireAdminAccess: (...args: unknown[]) => requireAdminAccess(...args),
  requireAuthenticatedUser: (...args: unknown[]) =>
    requireAuthenticatedUser(...args),
}))

import { assertToolAccess } from './auth.js'

describe('MCP assertToolAccess', () => {
  beforeEach(() => {
    requireAdminAccess.mockReset()
    requireAuthenticatedUser.mockReset()
  })

  it('requires admin for list_objects', async () => {
    requireAdminAccess.mockResolvedValue({ id: 'admin-1', adminAccess: true })
    const me = await assertToolAccess(
      { authorization: 'Bearer t' },
      'list_objects',
    )
    expect(requireAdminAccess).toHaveBeenCalled()
    expect(requireAuthenticatedUser).not.toHaveBeenCalled()
    expect(me.id).toBe('admin-1')
  })

  it('allows authenticated operator for query_records', async () => {
    requireAuthenticatedUser.mockResolvedValue({
      id: 'u1',
      adminAccess: false,
    })
    const me = await assertToolAccess(
      { authorization: 'Bearer t' },
      'query_records',
    )
    expect(requireAuthenticatedUser).toHaveBeenCalled()
    expect(me.id).toBe('u1')
  })

  it('denies admin tool when requireAdminAccess throws', async () => {
    requireAdminAccess.mockRejectedValue(new Error('Admin access required'))
    await expect(
      assertToolAccess({ authorization: 'Bearer t' }, 'export_domain_pack'),
    ).rejects.toThrow(/Admin access required/)
  })
})
