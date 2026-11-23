import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeUser } from '../adapters/usersAdapter.js'
import { SYSTEM_RECORD_ACCESS } from '../adapters/records/types.js'

const resolveRoleOwnerBypass = vi.fn()

vi.mock('./rolePermissions.js', () => ({
  resolveRoleOwnerBypass: (...args: unknown[]) => resolveRoleOwnerBypass(...args),
}))

vi.mock('./cacheEpoch.js', () => ({
  readCacheEpoch: async () => 1,
  bumpCacheEpoch: async () => 1,
}))

import {
  applyOwnerFilterIfNeeded,
  assertOwnerAccessIfNeeded,
  assertRecordOwner,
  bypassesRowLevelSecurity,
  clearRowLevelSecurityCache,
  mergeOwnerFilter,
  ownerEqFilter,
  parseInheritOwnerFrom,
  parseReadAlsoIf,
  parseReadAlsoIfSameRole,
  parseRowLevelSecurity,
  readInheritOwnerFrom,
  readReadAlsoIf,
  readReadAlsoIfSameRole,
  readRecordOwnerId,
  readRowLevelSecurity,
  ROW_OWNER_FIELD,
} from './rowLevelSecurity.js'
import { query } from '../db/pool.js'

vi.mock('../db/pool.js', () => ({
  query: vi.fn(async (sql: string) => {
    if (String(sql).includes('FROM public.entities')) {
      return [
        {
          api_name: 'opportunity',
          backend_config: { rowLevelSecurity: 'owner' },
        },
        {
          api_name: 'message',
          backend_config: {
            rowLevelSecurity: 'owner',
            rowLevelReadAlsoIf: ['to_user'],
            rowLevelReadAlsoIfSameRole: true,
          },
        },
      ]
    }
    if (String(sql).includes('app_users')) {
      return [{ actor_id: 'u1' }, { actor_id: 'u2' }]
    }
    return []
  }),
}))

function me(partial: Partial<MeUser> & { id: string }): MeUser {
  return {
    id: partial.id,
    firstName: partial.firstName ?? null,
    lastName: partial.lastName ?? null,
    email: partial.email ?? null,
    adminAccess: partial.adminAccess ?? false,
    roleId: partial.roleId ?? null,
    roleName: partial.roleName ?? null,
    roleAdminAccess: partial.roleAdminAccess ?? false,
    canAuthorReports: partial.canAuthorReports ?? false,
    mustChangePassword: partial.mustChangePassword ?? false,
  }
}

describe('rowLevelSecurity parse', () => {
  it('accepts owner and treats anything else as off', () => {
    expect(parseRowLevelSecurity('owner')).toBe('owner')
    expect(parseRowLevelSecurity(null)).toBeNull()
    expect(parseRowLevelSecurity('')).toBeNull()
    expect(parseRowLevelSecurity('share')).toBeNull()
    expect(readRowLevelSecurity({ rowLevelSecurity: 'owner' })).toBe('owner')
    expect(readRowLevelSecurity({})).toBeNull()
  })

  it('parses inheritOwnerFrom as a safe field api_name', () => {
    expect(parseInheritOwnerFrom('opportunity')).toBe('opportunity')
    expect(parseInheritOwnerFrom('Opportunity')).toBe('opportunity')
    expect(parseInheritOwnerFrom('bad-field')).toBeNull()
    expect(parseInheritOwnerFrom('')).toBeNull()
    expect(readInheritOwnerFrom({ inheritOwnerFrom: 'opportunity' })).toBe(
      'opportunity',
    )
    expect(readInheritOwnerFrom({})).toBeNull()
  })

  it('parses rowLevelReadAlsoIf and drops owner/audit fields', () => {
    expect(parseReadAlsoIf(['to_user', 'owner_id', 'user_created', 'To_User'])).toEqual([
      'to_user',
    ])
    expect(parseReadAlsoIf(null)).toEqual([])
    expect(readReadAlsoIf({ rowLevelReadAlsoIf: ['to_user'] })).toEqual(['to_user'])
    expect(readReadAlsoIf({})).toEqual([])
  })

  it('parses rowLevelReadAlsoIfSameRole', () => {
    expect(parseReadAlsoIfSameRole(true)).toBe(true)
    expect(parseReadAlsoIfSameRole('true')).toBe(true)
    expect(parseReadAlsoIfSameRole(false)).toBe(false)
    expect(parseReadAlsoIfSameRole(null)).toBe(false)
    expect(
      readReadAlsoIfSameRole({ rowLevelReadAlsoIfSameRole: true }),
    ).toBe(true)
    expect(readReadAlsoIfSameRole({})).toBe(false)
  })
})

describe('mergeOwnerFilter', () => {
  it('returns owner-only when filter is empty', () => {
    expect(mergeOwnerFilter(null, 'u1')).toEqual(ownerEqFilter('u1'))
    expect(mergeOwnerFilter({}, 'u1')).toEqual(ownerEqFilter('u1'))
  })

  it('ANDs owner with an existing filter', () => {
    expect(mergeOwnerFilter({ name: { _eq: 'Acme' } }, 'u1')).toEqual({
      _and: [{ name: { _eq: 'Acme' } }, { [ROW_OWNER_FIELD]: { _eq: 'u1' } }],
    })
  })

  it('ORs owner with readAlsoIf fields', () => {
    expect(mergeOwnerFilter(null, 'u1', ['to_user'])).toEqual({
      _or: [
        { [ROW_OWNER_FIELD]: { _eq: 'u1' } },
        { to_user: { _eq: 'u1' } },
      ],
    })
  })

  it('uses owner_id _in peer ids when same-role peers are provided', () => {
    expect(
      mergeOwnerFilter(null, 'u1', ['to_user'], {
        sameRolePeerIds: ['u1', 'u2'],
      }),
    ).toEqual({
      _or: [
        { [ROW_OWNER_FIELD]: { _in: ['u1', 'u2'] } },
        { to_user: { _eq: 'u1' } },
      ],
    })
  })
})

describe('assertRecordOwner', () => {
  it('allows the owner and admins', () => {
    expect(() =>
      assertRecordOwner(me({ id: 'u1' }), 'opportunity', {
        owner_id: 'u1',
      }),
    ).not.toThrow()
    expect(() =>
      assertRecordOwner(
        me({ id: 'u2', adminAccess: true }),
        'opportunity',
        { owner_id: 'u1' },
      ),
    ).not.toThrow()
    expect(() =>
      assertRecordOwner(
        me({ id: 'u2', roleAdminAccess: true }),
        'opportunity',
        { owner_id: 'u1' },
      ),
    ).not.toThrow()
  })

  it('denies other users and null owner', () => {
    expect(() =>
      assertRecordOwner(me({ id: 'u2' }), 'opportunity', {
        owner_id: 'u1',
      }),
    ).toThrow('Permission denied: read on opportunity')
    expect(() =>
      assertRecordOwner(me({ id: 'u1' }), 'opportunity', { owner_id: null }, 'update'),
    ).toThrow('Permission denied: update on opportunity')
  })

  it('allows read when to_user matches even if not owner', () => {
    expect(() =>
      assertRecordOwner(
        me({ id: 'admin1' }),
        'message',
        { owner_id: 'rep1', to_user: 'admin1' },
        'read',
        ['to_user'],
      ),
    ).not.toThrow()
    expect(() =>
      assertRecordOwner(
        me({ id: 'admin1' }),
        'message',
        { owner_id: 'rep1', to_user: 'admin1' },
        'update',
        ['to_user'],
      ),
    ).toThrow('Permission denied: update on message')
  })

  it('allows read for same-role peers but not update', () => {
    expect(() =>
      assertRecordOwner(
        me({ id: 'u1', roleId: 'sales-rep' }),
        'message',
        { owner_id: 'u2' },
        'read',
        [],
        { sameRolePeerIds: ['u1', 'u2'] },
      ),
    ).not.toThrow()
    expect(() =>
      assertRecordOwner(
        me({ id: 'u1', roleId: 'sales-rep' }),
        'message',
        { owner_id: 'u2' },
        'update',
        [],
        { sameRolePeerIds: ['u1', 'u2'] },
      ),
    ).toThrow('Permission denied: update on message')
  })

  it('reads owner from nested { id } shapes', () => {
    expect(readRecordOwnerId({ owner_id: { id: 'u1' } })).toBe('u1')
    expect(readRecordOwnerId({ user_created: 'legacy-u' })).toBe('legacy-u')
    expect(() =>
      assertRecordOwner(me({ id: 'u1' }), 'opportunity', {
        user_created: { id: 'u1' },
      }),
    ).not.toThrow()
  })
})

describe('bypassesRowLevelSecurity', () => {
  it('bypasses system and admin only', () => {
    expect(bypassesRowLevelSecurity(SYSTEM_RECORD_ACCESS)).toBe(true)
    expect(bypassesRowLevelSecurity({ me: me({ id: 'u1', adminAccess: true }) })).toBe(
      true,
    )
    expect(bypassesRowLevelSecurity({ me: me({ id: 'u1' }) })).toBe(false)
    expect(bypassesRowLevelSecurity({ me: null })).toBe(false)
  })
})

describe('View all / Modify all bypass', () => {
  beforeEach(() => {
    clearRowLevelSecurityCache()
    resolveRoleOwnerBypass.mockReset()
    resolveRoleOwnerBypass.mockResolvedValue({ viewAll: false, modifyAll: false })
  })

  it('skips owner list filter when role has View all', async () => {
    resolveRoleOwnerBypass.mockResolvedValue({ viewAll: true, modifyAll: false })
    const filter = { name: { _eq: 'Acme' } }
    await expect(
      applyOwnerFilterIfNeeded('opportunity', { me: me({ id: 'u1' }) }, filter),
    ).resolves.toEqual(filter)
  })

  it('applies owner filter when role has neither View nor Modify all', async () => {
    const filter = { name: { _eq: 'Acme' } }
    await expect(
      applyOwnerFilterIfNeeded('opportunity', { me: me({ id: 'u1' }) }, filter),
    ).resolves.toEqual({
      _and: [filter, { [ROW_OWNER_FIELD]: { _eq: 'u1' } }],
    })
  })

  it('allows update of another user row when role has Modify all', async () => {
    resolveRoleOwnerBypass.mockResolvedValue({ viewAll: true, modifyAll: true })
    await expect(
      assertOwnerAccessIfNeeded(
        'opportunity',
        { me: me({ id: 'u1' }) },
        { owner_id: 'u2' },
        'update',
      ),
    ).resolves.toBeUndefined()
  })

  it('denies update of another user row with View all only', async () => {
    resolveRoleOwnerBypass.mockResolvedValue({ viewAll: true, modifyAll: false })
    await expect(
      assertOwnerAccessIfNeeded(
        'opportunity',
        { me: me({ id: 'u1' }) },
        { owner_id: 'u2' },
        'update',
      ),
    ).rejects.toThrow('Permission denied: update on opportunity')
  })

  it('list filter expands to same-role peers when enabled on the entity', async () => {
    await expect(
      applyOwnerFilterIfNeeded(
        'message',
        { me: me({ id: 'u1', roleId: 'sales-rep' }) },
        null,
      ),
    ).resolves.toEqual({
      _or: [
        { [ROW_OWNER_FIELD]: { _in: ['u1', 'u2'] } },
        { to_user: { _eq: 'u1' } },
      ],
    })
    expect(query).toHaveBeenCalled()
  })

  it('allows get-by-id read for a same-role peer on message', async () => {
    await expect(
      assertOwnerAccessIfNeeded(
        'message',
        { me: me({ id: 'u1', roleId: 'sales-rep' }) },
        { owner_id: 'u2' },
        'read',
      ),
    ).resolves.toBeUndefined()
  })
})
