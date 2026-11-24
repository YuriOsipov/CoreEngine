import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveAppRoleId = vi.fn()

vi.mock('../services/rolePermissions.js', () => ({
  resolveAppRoleId: (...args: unknown[]) => resolveAppRoleId(...args),
}))

import { resolveListVisibility } from './listVisibility.js'

describe('resolveListVisibility', () => {
  beforeEach(() => {
    resolveAppRoleId.mockReset()
  })

  it('returns admin for adminAccess', async () => {
    await expect(
      resolveListVisibility({
        id: 'u1',
        adminAccess: true,
        roleAdminAccess: false,
        roleId: 'r1',
      } as never),
    ).resolves.toEqual({ kind: 'admin' })
    expect(resolveAppRoleId).not.toHaveBeenCalled()
  })

  it('returns scoped userId + dual role refs for non-admins', async () => {
    resolveAppRoleId.mockResolvedValue('app-role-uuid')
    await expect(
      resolveListVisibility({
        id: 'user-1',
        adminAccess: false,
        roleAdminAccess: false,
        roleId: 'backend-role',
      } as never),
    ).resolves.toEqual({
      kind: 'scoped',
      userId: 'user-1',
      roleRefs: ['backend-role', 'app-role-uuid'],
    })
  })
})
