import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMe = vi.fn()

vi.mock('../adapters/usersAdapter.js', () => ({
  fetchMe: (...args: unknown[]) => fetchMe(...args),
}))

import {
  PASSWORD_CHANGE_REQUIRED,
  requireAdminAccess,
  requireAuthenticatedUser,
} from './accessGuards.js'

describe('requireAuthenticatedUser', () => {
  beforeEach(() => {
    fetchMe.mockReset()
  })

  it('rejects missing Authorization header without calling DB-backed me', async () => {
    await expect(
      requireAuthenticatedUser({ authorization: null }),
    ).rejects.toThrow('Authentication required')
    expect(fetchMe).not.toHaveBeenCalled()
  })

  it('rejects bearer tokens that do not resolve to a user id', async () => {
    fetchMe.mockResolvedValue({
      id: null,
      adminAccess: false,
      roleId: null,
      roleAdminAccess: false,
      mustChangePassword: false,
    })
    await expect(
      requireAuthenticatedUser({ authorization: 'Bearer junk' }),
    ).rejects.toThrow('Authentication required')
  })

  it('blocks API use while must_change_password is set', async () => {
    fetchMe.mockResolvedValue({
      id: 'u1',
      adminAccess: true,
      roleId: 'r1',
      roleAdminAccess: true,
      mustChangePassword: true,
    })
    await expect(
      requireAuthenticatedUser({ authorization: 'Bearer t' }),
    ).rejects.toThrow(PASSWORD_CHANGE_REQUIRED)
  })

  it('allows change-password / me when allowPasswordChange is set', async () => {
    fetchMe.mockResolvedValue({
      id: 'u1',
      adminAccess: false,
      roleId: 'r1',
      roleAdminAccess: false,
      mustChangePassword: true,
    })
    const me = await requireAuthenticatedUser(
      { authorization: 'Bearer t' },
      { allowPasswordChange: true },
    )
    expect(me.id).toBe('u1')
    expect(me.mustChangePassword).toBe(true)
  })
})

describe('requireAdminAccess', () => {
  beforeEach(() => {
    fetchMe.mockReset()
  })

  it('rejects non-admin authenticated users', async () => {
    fetchMe.mockResolvedValue({
      id: 'u1',
      adminAccess: false,
      roleId: 'r1',
      roleAdminAccess: false,
      mustChangePassword: false,
    })
    await expect(
      requireAdminAccess({ authorization: 'Bearer t' }),
    ).rejects.toThrow('Admin access required')
  })
})
