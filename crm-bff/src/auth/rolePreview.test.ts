import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
}))

import type { MeUser } from '../adapters/usersAdapter.js'
import {
  ROLE_PREVIEW_DEFAULT,
  ROLE_PREVIEW_NO_USER_ID,
  actorIdFromMe,
  effectiveActorIdFromMe,
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
    canAuthorReports: true,
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

  it('maps default preview to a non-admin with deny sentinel id', async () => {
    const me = await applyRolePreview(admin(), ROLE_PREVIEW_DEFAULT)
    expect(me.adminAccess).toBe(false)
    expect(me.roleAdminAccess).toBe(false)
    expect(me.canAuthorReports).toBe(false)
    expect(me.roleId).toBeNull()
    expect(me.id).toBe(ROLE_PREVIEW_NO_USER_ID)
    expect(me.auditActorId).toBe('admin-1')
  })

  it('binds a concrete role to a sample user for Owner RLS', async () => {
    query
      .mockResolvedValueOnce([
        {
          id: 'pricing',
          name: 'Pricing Manager',
          is_admin: false,
          can_author_reports: true,
        },
      ])
      .mockResolvedValueOnce([
        {
          actor_id: 'rep-backend-1',
          first_name: 'Sam',
          last_name: 'Rep',
          email: 'rep@example.com',
        },
      ])
    const me = await applyRolePreview(admin(), 'pricing')
    expect(me).toMatchObject({
      id: 'rep-backend-1',
      auditActorId: 'admin-1',
      firstName: 'Sam',
      lastName: 'Rep',
      email: 'rep@example.com',
      adminAccess: false,
      roleAdminAccess: false,
      canAuthorReports: true,
      roleId: 'pricing',
      roleName: 'Pricing Manager',
    })
  })

  it('uses deny sentinel when the role has no active users', async () => {
    query
      .mockResolvedValueOnce([
        { id: 'pricing', name: 'Pricing', is_admin: false, can_author_reports: false },
      ])
      .mockResolvedValueOnce([])
    const me = await applyRolePreview(admin(), 'pricing')
    expect(me.id).toBe(ROLE_PREVIEW_NO_USER_ID)
    expect(me.auditActorId).toBe('admin-1')
    expect(me.adminAccess).toBe(false)
    expect(me.roleId).toBe('pricing')
  })

  it('keeps roleAdminAccess when the previewed role is admin', async () => {
    query.mockResolvedValueOnce([
      { id: 'ops-admin', name: 'Ops Admin', is_admin: true, can_author_reports: false },
    ])
    const me = await applyRolePreview(admin(), 'ops-admin')
    expect(me.adminAccess).toBe(false)
    expect(me.roleAdminAccess).toBe(true)
    expect(me.canAuthorReports).toBe(true)
    expect(me.roleId).toBe('ops-admin')
    expect(me.id).toBe('admin-1')
    expect(me.auditActorId).toBe('admin-1')
  })

  it('rejects unknown preview roles', async () => {
    query.mockResolvedValue([])
    await expect(applyRolePreview(admin(), 'missing')).rejects.toThrow(
      'Invalid role preview',
    )
  })

  it('actorIdFromMe prefers auditActorId for stamps', () => {
    expect(actorIdFromMe({ id: 'preview-user', auditActorId: 'admin-1' })).toBe(
      'admin-1',
    )
    expect(actorIdFromMe({ id: 'only-id' })).toBe('only-id')
    expect(actorIdFromMe(null)).toBeNull()
  })

  it('effectiveActorIdFromMe prefers preview me.id for UI stamps', () => {
    expect(
      effectiveActorIdFromMe({ id: 'preview-user', auditActorId: 'admin-1' }),
    ).toBe('preview-user')
    expect(effectiveActorIdFromMe({ id: ROLE_PREVIEW_NO_USER_ID, auditActorId: 'admin-1' })).toBe(
      'admin-1',
    )
    expect(effectiveActorIdFromMe({ id: 'only-id' })).toBe('only-id')
  })
})
