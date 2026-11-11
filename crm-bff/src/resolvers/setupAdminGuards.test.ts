import { describe, expect, it, vi } from 'vitest'

vi.mock('../adapters/usersAdapter.js', () => ({
  fetchMe: vi.fn(async () => {
    throw new Error('fetchMe should not run without Authorization')
  }),
  listUsers: vi.fn(),
}))

import { fetchMe } from '../adapters/usersAdapter.js'
import { requireAdminAccess, resolvers } from './index.js'

describe('requireAdminAccess', () => {
  it('rejects missing authorization', async () => {
    await expect(requireAdminAccess({ authorization: null })).rejects.toThrow(
      'Admin access required',
    )
    await expect(requireAdminAccess(undefined)).rejects.toThrow(
      'Admin access required',
    )
  })
})

describe('Setup / registry mutations require admin', () => {
  const noAuth = { authorization: null, clientKey: 'test' }

  it('createRegistryEntity rejects unauthenticated callers before registry work', async () => {
    await expect(
      resolvers.Mutation.createRegistryEntity(
        null,
        {
          input: { apiName: 'x', label: 'X' },
        },
        noAuth,
      ),
    ).rejects.toThrow('Admin access required')
  })

  it('createRegistryEntity rejects authenticated non-admin callers', async () => {
    vi.mocked(fetchMe).mockResolvedValueOnce({
      id: 'user-1',
      firstName: null,
      lastName: null,
      email: 'noperms@example.com',
      adminAccess: false,
      roleId: 'role-empty',
      roleName: 'Empty',
      roleAdminAccess: false,
      mustChangePassword: false,
    })
    await expect(
      resolvers.Mutation.createRegistryEntity(
        null,
        {
          input: { apiName: 'throwaway_entity', label: 'Throwaway' },
        },
        { authorization: 'Bearer user-token', clientKey: 'test' },
      ),
    ).rejects.toThrow('Admin access required')
  })

  it('upsertLayoutSetting rejects unauthenticated callers', async () => {
    await expect(
      resolvers.Mutation.upsertLayoutSetting(
        null,
        {
          input: {
            entityApiName: 'opportunity',
            groupKey: 'detail',
            body: {},
          },
        },
        noAuth,
      ),
    ).rejects.toThrow('Admin access required')
  })

  it('runSchemaSync rejects unauthenticated callers', async () => {
    await expect(
      resolvers.Mutation.runSchemaSync(
        null,
        { entity: 'opportunity', dryRun: true },
        noAuth,
      ),
    ).rejects.toThrow('Admin access required')
  })

  it('upsertDashboard rejects unauthenticated callers', async () => {
    await expect(
      resolvers.Mutation.upsertDashboard(
        null,
        { input: { name: 'Home' } },
        noAuth,
      ),
    ).rejects.toThrow('Admin access required')
  })

  it('schemaDrift query rejects unauthenticated callers', async () => {
    await expect(
      resolvers.Query.schemaDrift(null, { entity: null }, noAuth),
    ).rejects.toThrow('Admin access required')
  })

  it('generateDocument rejects missing or invalid Authorization', async () => {
    await expect(
      resolvers.Mutation.generateDocument(
        null,
        {
          input: {
            collectionName: 'opportunity',
            recordId: '1',
            templateId: 't1',
          },
        },
        noAuth,
      ),
    ).rejects.toThrow('Authentication required')
  })
})
