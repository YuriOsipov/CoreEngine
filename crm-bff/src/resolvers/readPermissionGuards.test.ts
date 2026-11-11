import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMe = vi.fn()

vi.mock('../adapters/usersAdapter.js', () => ({
  fetchMe: (...args: unknown[]) => fetchMe(...args),
  listUsers: vi.fn(),
}))

import { assertEntityPermission } from '../services/rolePermissions.js'
import {
  requireAuthenticatedUser,
  resolvers,
} from './index.js'

describe('assertEntityPermission auth gate', () => {
  beforeEach(() => {
    fetchMe.mockReset()
  })

  it('denies anonymous callers even for users/roles/files read bypass', async () => {
    fetchMe.mockResolvedValue({
      id: null,
      firstName: null,
      lastName: null,
      email: null,
      adminAccess: false,
      roleId: null,
      roleName: null,
      roleAdminAccess: false,
    })
    await expect(
      assertEntityPermission({ authorization: 'Bearer x' }, 'files', 'read'),
    ).rejects.toThrow(/Permission denied/)
    await expect(
      assertEntityPermission({ authorization: 'Bearer x' }, 'opportunity', 'read'),
    ).rejects.toThrow(/Permission denied/)
  })
})

describe('requireAuthenticatedUser', () => {
  beforeEach(() => {
    fetchMe.mockReset()
  })

  it('rejects missing authorization', async () => {
    await expect(requireAuthenticatedUser({ authorization: null })).rejects.toThrow(
      'Authentication required',
    )
  })

  it('rejects tokens that resolve to no user id', async () => {
    fetchMe.mockResolvedValue({
      id: null,
      adminAccess: false,
      roleId: null,
      roleAdminAccess: false,
    })
    await expect(
      requireAuthenticatedUser({ authorization: 'Bearer junk' }),
    ).rejects.toThrow('Authentication required')
  })
})

describe('sensitive read resolvers require auth / entity read', () => {
  const noAuth = { authorization: null, clientKey: 'test' }

  beforeEach(() => {
    fetchMe.mockResolvedValue({
      id: null,
      firstName: null,
      lastName: null,
      email: null,
      adminAccess: false,
      roleId: null,
      roleName: null,
      roleAdminAccess: false,
    })
  })

  it('recordRevisions requires entity read permission', async () => {
    await expect(
      resolvers.Query.recordRevisions(
        null,
        { entity: 'opportunity', recordId: '1' },
        noAuth,
      ),
    ).rejects.toThrow(/Permission denied|Authentication required/)
  })

  it('recordActivities requires entity read permission', async () => {
    await expect(
      resolvers.Query.recordActivities(
        null,
        { entity: 'opportunity', recordId: '1' },
        noAuth,
      ),
    ).rejects.toThrow(/Permission denied|Authentication required/)
  })

  it('recordFiles requires parent collection read permission', async () => {
    await expect(
      resolvers.Query.recordFiles(
        null,
        { collection: 'opportunity', recordId: '1' },
        noAuth,
      ),
    ).rejects.toThrow(/Permission denied|Authentication required/)
  })

  it('layoutSettings and registry reads require authentication', async () => {
    await expect(
      resolvers.Query.layoutSettings(null, {}, noAuth),
    ).rejects.toThrow('Authentication required')
    await expect(
      resolvers.Query.entities(null, {}, noAuth),
    ).rejects.toThrow('Authentication required')
    await expect(
      resolvers.Query.registrySnapshot(null, {}, noAuth),
    ).rejects.toThrow('Authentication required')
  })

  it('users and roles require authentication', async () => {
    await expect(resolvers.Query.users(null, {}, noAuth)).rejects.toThrow(
      /Permission denied|Authentication required/,
    )
    await expect(resolvers.Query.roles(null, {}, noAuth)).rejects.toThrow(
      /Permission denied|Authentication required/,
    )
  })
})
