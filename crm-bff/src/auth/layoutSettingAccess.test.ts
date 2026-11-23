import { beforeEach, describe, expect, it, vi } from 'vitest'

const findLayoutSettingBySettingId = vi.fn()
const assertMeEntityPermission = vi.fn()
const resolveAppRoleId = vi.fn()

vi.mock('../schema/layoutSettings.js', () => ({
  findLayoutSettingBySettingId: (...args: unknown[]) =>
    findLayoutSettingBySettingId(...args),
}))

vi.mock('../services/rolePermissions.js', () => ({
  assertMeEntityPermission: (...args: unknown[]) => assertMeEntityPermission(...args),
  resolveAppRoleId: (...args: unknown[]) => resolveAppRoleId(...args),
}))

import type { MeUser } from '../adapters/usersAdapter.js'
import {
  authorizeLayoutSettingDelete,
  authorizeLayoutSettingUpsert,
} from './layoutSettingAccess.js'

function user(overrides: Partial<MeUser> = {}): MeUser {
  return {
    id: 'user-1',
    firstName: null,
    lastName: null,
    email: null,
    adminAccess: false,
    roleId: 'role-sales-mgr',
    roleName: 'Sales Manager',
    roleAdminAccess: false,
    canAuthorReports: true,
    mustChangePassword: false,
    ...overrides,
  }
}

describe('authorizeLayoutSettingUpsert', () => {
  beforeEach(() => {
    findLayoutSettingBySettingId.mockReset()
    assertMeEntityPermission.mockReset()
    resolveAppRoleId.mockReset()
    resolveAppRoleId.mockResolvedValue('role-sales-mgr')
    assertMeEntityPermission.mockImplementation(async (me: MeUser) => me)
  })

  it('allows admins any group without forcing role', async () => {
    const input = {
      entityApiName: 'opportunity',
      groupKey: 'entity',
      subGroup: 'full',
      roleId: null,
      body: {},
    }
    await expect(
      authorizeLayoutSettingUpsert(user({ adminAccess: true, roleAdminAccess: true }), input),
    ).resolves.toEqual(input)
    expect(assertMeEntityPermission).not.toHaveBeenCalled()
  })

  it('rejects non-authors', async () => {
    await expect(
      authorizeLayoutSettingUpsert(user({ canAuthorReports: false }), {
        entityApiName: 'opportunity',
        groupKey: 'report',
        subGroup: 'full',
        body: {},
      }),
    ).rejects.toThrow('Admin access required')
  })

  it('rejects authors for non-report groups and folders', async () => {
    await expect(
      authorizeLayoutSettingUpsert(user(), {
        entityApiName: 'opportunity',
        groupKey: 'entity',
        subGroup: 'full',
        body: {},
      }),
    ).rejects.toThrow('Admin access required')

    await expect(
      authorizeLayoutSettingUpsert(user(), {
        entityApiName: 'report',
        groupKey: 'report',
        subGroup: 'folder',
        body: {},
      }),
    ).rejects.toThrow('Admin access required')
  })

  it('forces own role and checks entity read for new reports', async () => {
    const next = await authorizeLayoutSettingUpsert(user(), {
      entityApiName: 'opportunity',
      groupKey: 'report',
      subGroup: 'full',
      roleId: null,
      body: { title: 'Pipeline' },
    })
    expect(next.roleId).toBe('role-sales-mgr')
    expect(assertMeEntityPermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'opportunity',
      'read',
    )
  })

  it('rejects updating a global or other-role report', async () => {
    findLayoutSettingBySettingId.mockResolvedValue({
      id: 'ls-1',
      entityApiName: 'opportunity',
      groupKey: 'report',
      subGroup: 'full',
      roleId: null,
      payload: { __meta: { role: null } },
    })
    await expect(
      authorizeLayoutSettingUpsert(user(), {
        settingId: 'rep-1',
        entityApiName: 'opportunity',
        groupKey: 'report',
        subGroup: 'full',
        body: {},
      }),
    ).rejects.toThrow('Admin access required')

    findLayoutSettingBySettingId.mockResolvedValue({
      id: 'ls-2',
      entityApiName: 'opportunity',
      groupKey: 'report',
      subGroup: 'full',
      roleId: 'role-other',
      payload: { __meta: { role: 'role-other' } },
    })
    await expect(
      authorizeLayoutSettingUpsert(user(), {
        settingId: 'rep-2',
        entityApiName: 'opportunity',
        groupKey: 'report',
        subGroup: 'full',
        body: {},
      }),
    ).rejects.toThrow('Admin access required')
  })

  it('allows updating an own-role report', async () => {
    findLayoutSettingBySettingId.mockResolvedValue({
      id: 'ls-3',
      entityApiName: 'opportunity',
      groupKey: 'report',
      subGroup: 'full',
      roleId: 'role-sales-mgr',
      payload: { __meta: { role: 'role-sales-mgr' } },
    })
    const next = await authorizeLayoutSettingUpsert(user(), {
      settingId: 'rep-3',
      entityApiName: 'opportunity',
      groupKey: 'report',
      subGroup: 'full',
      roleId: 'role-other',
      body: {},
    })
    expect(next.roleId).toBe('role-sales-mgr')
  })
})

describe('authorizeLayoutSettingDelete', () => {
  beforeEach(() => {
    findLayoutSettingBySettingId.mockReset()
    resolveAppRoleId.mockReset()
    resolveAppRoleId.mockResolvedValue('role-sales-mgr')
  })

  it('allows admin delete of any setting', async () => {
    findLayoutSettingBySettingId.mockResolvedValue({
      id: 'ls-folder',
      entityApiName: 'report',
      groupKey: 'report',
      subGroup: 'folder',
      roleId: null,
      payload: {},
    })
    await expect(
      authorizeLayoutSettingDelete(
        user({ adminAccess: true, roleAdminAccess: true }),
        'folder-1',
      ),
    ).resolves.toMatchObject({ id: 'ls-folder' })
  })

  it('rejects author delete of folders and global reports', async () => {
    findLayoutSettingBySettingId.mockResolvedValue({
      id: 'ls-folder',
      entityApiName: 'report',
      groupKey: 'report',
      subGroup: 'folder',
      roleId: null,
      payload: {},
    })
    await expect(
      authorizeLayoutSettingDelete(user(), 'folder-1'),
    ).rejects.toThrow('Admin access required')

    findLayoutSettingBySettingId.mockResolvedValue({
      id: 'ls-global',
      entityApiName: 'opportunity',
      groupKey: 'report',
      subGroup: 'full',
      roleId: null,
      payload: { __meta: { role: null } },
    })
    await expect(
      authorizeLayoutSettingDelete(user(), 'rep-global'),
    ).rejects.toThrow('Admin access required')
  })

  it('allows author delete of own-role reports', async () => {
    findLayoutSettingBySettingId.mockResolvedValue({
      id: 'ls-own',
      entityApiName: 'opportunity',
      groupKey: 'report',
      subGroup: 'full',
      roleId: 'role-sales-mgr',
      payload: { __meta: { role: 'role-sales-mgr' } },
    })
    await expect(
      authorizeLayoutSettingDelete(user(), 'rep-own'),
    ).resolves.toMatchObject({ id: 'ls-own' })
  })
})
