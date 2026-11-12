import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
}))

import type { MeUser } from '../adapters/usersAdapter.js'
import {
  ROLE_PREVIEW_DEFAULT,
  applyRolePreview,
  readRolePreviewHeader,
} from './rolePreview.js'

function admin(overrides: Partial<MeUser> = {}): MeUser {
  return {
    id: 'admin-1',
    firstName: null,
    lastName: null,
    email: null,
    adminAccess: true,
    roleId: 'admin-role',
    roleName: 'Administrator',
    roleAdminAccess: true,
    mustChangePassword: false,
    ...overrides,
  }
}

describe('rolePreview', () => {
  beforeEach(() => {
    query.mockReset()
  })

  it('reads the preview header case-insensitively via the lowercase key', () => {
    expect(readRolePreviewHeader({ 'x-role-preview': ' role-1 ' })).toBe('role-1')
    expect(readRolePreviewHeader({})).toBeNull()
  })

  it('ignores the header for non-admins', async () => {
    const me = admin({ adminAccess: false, roleAdminAccess: false, roleId: 'sales' })
    expect(await applyRolePreview(me, 'other-role')).toEqual(me)
    expect(query).not.toHaveBeenCalled()
  })

  it('maps default preview to a non-admin with no role', async () => {
    const me = await applyRolePreview(admin(), ROLE_PREVIEW_DEFAULT)
    expect(me.adminAccess).toBe(false)
    expect(me.roleAdminAccess).toBe(false)
    expect(me.roleId).toBeNull()
    expect(me.id).toBe('admin-1')
  })

  it('binds a concrete role and clears admin bypass', async () => {
    query.mockResolvedValue([{ id: 'pricing', is_admin: false }])
    const me = await applyRolePreview(admin(), 'pricing')
    expect(me).toMatchObject({
      id: 'admin-1',
      adminAccess: false,
      roleAdminAccess: false,
      roleId: 'pricing',
    })
  })

  it('keeps roleAdminAccess when the previewed role is admin', async () => {
    query.mockResolvedValue([{ id: 'ops-admin', is_admin: true }])
    const me = await applyRolePreview(admin(), 'ops-admin')
    expect(me.adminAccess).toBe(false)
    expect(me.roleAdminAccess).toBe(true)
    expect(me.roleId).toBe('ops-admin')
  })

  it('rejects unknown preview roles', async () => {
    query.mockResolvedValue([])
    await expect(applyRolePreview(admin(), 'missing')).rejects.toThrow(
      'Invalid role preview',
    )
  })
})
