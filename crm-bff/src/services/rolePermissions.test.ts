import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMe = vi.fn()
const query = vi.fn()

vi.mock('../adapters/usersAdapter.js', () => ({
  fetchMe: (...args: unknown[]) => fetchMe(...args),
}))

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
  pool: { query: vi.fn(), end: vi.fn() },
}))

import { PASSWORD_CHANGE_REQUIRED } from '../auth/accessGuards.js'
import { assertEntityPermission } from './rolePermissions.js'

describe('assertEntityPermission', () => {
  beforeEach(() => {
    fetchMe.mockReset()
    query.mockReset()
  })

  it('rejects callers with no user id before special-case bypasses', async () => {
    fetchMe.mockResolvedValue({
      id: null,
      adminAccess: false,
      roleId: null,
      roleAdminAccess: false,
      mustChangePassword: false,
    })
    await expect(
      assertEntityPermission({ authorization: null }, 'files', 'read'),
    ).rejects.toThrow('Permission denied: read on files')
  })

  it('denies authenticated files browse without a matrix row (use parent ACL paths)', async () => {
    fetchMe.mockResolvedValue({
      id: 'user-1',
      adminAccess: false,
      roleId: 'role-1',
      roleAdminAccess: false,
      mustChangePassword: false,
    })
    query.mockResolvedValueOnce([]) // joined role + flags → deny
    await expect(
      assertEntityPermission({ authorization: 'Bearer t' }, 'files', 'read'),
    ).rejects.toThrow('Permission denied: read on files')
  })

  it('still allows authenticated users to read users/roles without a matrix row', async () => {
    fetchMe.mockResolvedValue({
      id: 'user-1',
      adminAccess: false,
      roleId: 'role-1',
      roleAdminAccess: false,
      mustChangePassword: false,
    })
    await expect(
      assertEntityPermission({ authorization: 'Bearer t' }, 'users', 'read'),
    ).resolves.toMatchObject({ id: 'user-1' })
    await expect(
      assertEntityPermission({ authorization: 'Bearer t' }, 'roles', 'read'),
    ).resolves.toMatchObject({ id: 'user-1' })
  })

  it('allows non-admins to update their own users record', async () => {
    fetchMe.mockResolvedValue({
      id: 'user-1',
      adminAccess: false,
      roleId: 'role-1',
      roleAdminAccess: false,
      mustChangePassword: false,
    })
    await expect(
      assertEntityPermission(
        { authorization: 'Bearer t' },
        'users',
        'update',
        { recordId: 'user-1' },
      ),
    ).resolves.toMatchObject({ id: 'user-1' })
  })

  it('denies non-admins updating another users record', async () => {
    fetchMe.mockResolvedValue({
      id: 'user-1',
      adminAccess: false,
      roleId: 'role-1',
      roleAdminAccess: false,
      mustChangePassword: false,
    })
    query.mockResolvedValueOnce([]) // userRecordMatchesMe miss
    await expect(
      assertEntityPermission(
        { authorization: 'Bearer t' },
        'users',
        'update',
        { recordId: 'other-user' },
      ),
    ).rejects.toThrow('Permission denied: update on users')
  })

  it('blocks entity access while must_change_password is set', async () => {
    fetchMe.mockResolvedValue({
      id: 'user-1',
      adminAccess: true,
      roleId: 'role-admin',
      roleAdminAccess: true,
      mustChangePassword: true,
    })
    await expect(
      assertEntityPermission({ authorization: 'Bearer t' }, 'account', 'read'),
    ).rejects.toThrow(PASSWORD_CHANGE_REQUIRED)
  })

  it('denies non-admin reads and writes on matrix-excluded entities', async () => {
    fetchMe.mockResolvedValue({
      id: 'user-1',
      adminAccess: false,
      roleId: 'role-1',
      roleAdminAccess: false,
      mustChangePassword: false,
    })
    await expect(
      assertEntityPermission(
        { authorization: 'Bearer t' },
        'doc_template',
        'read',
      ),
    ).rejects.toThrow('Permission denied: read on doc_template')
    await expect(
      assertEntityPermission(
        { authorization: 'Bearer t' },
        'doc_value',
        'read',
      ),
    ).rejects.toThrow('Permission denied: read on doc_value')
    await expect(
      assertEntityPermission({ authorization: 'Bearer t' }, 'Setting', 'update'),
    ).rejects.toThrow('Permission denied: update on Setting')
  })
})
