import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeUser } from '../adapters/usersAdapter.js'
import { SYSTEM_RECORD_ACCESS } from '../adapters/records/types.js'

const resolveRoleOwnerBypass = vi.fn()

vi.mock('./rolePermissions.js', () => ({
  resolveRoleOwnerBypass: (...args: unknown[]) => resolveRoleOwnerBypass(...args),
}))

import {
  applyOwnerFilterIfNeeded,
  assertOwnerAccessIfNeeded,
  assertRecordOwner,
  bypassesRowLevelSecurity,
  clearRowLevelSecurityCache,
  mergeOwnerFilter,
  ownerEqFilter,
  parseRowLevelSecurity,
  readRecordOwnerId,
  readRowLevelSecurity,
  ROW_OWNER_FIELD,
} from './rowLevelSecurity.js'

vi.mock('../db/pool.js', () => ({
  query: vi.fn(async () => [
    {
      api_name: 'opportunity',
      backend_config: { rowLevelSecurity: 'owner' },
    },
  ]),
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
})

describe('assertRecordOwner', () => {
  it('allows the owner and admins', () => {
    expect(() =>
      assertRecordOwner(me({ id: 'u1' }), 'opportunity', {
        user_created: 'u1',
      }),
    ).not.toThrow()
    expect(() =>
      assertRecordOwner(
        me({ id: 'u2', adminAccess: true }),
        'opportunity',
        { user_created: 'u1' },
      ),
    ).not.toThrow()
    expect(() =>
      assertRecordOwner(
        me({ id: 'u2', roleAdminAccess: true }),
        'opportunity',
        { user_created: 'u1' },
      ),
    ).not.toThrow()
  })

  it('denies other users and null owner', () => {
    expect(() =>
      assertRecordOwner(me({ id: 'u2' }), 'opportunity', {
        user_created: 'u1',
      }),
    ).toThrow('Permission denied: read on opportunity')
    expect(() =>
      assertRecordOwner(me({ id: 'u1' }), 'opportunity', { user_created: null }, 'update'),
    ).toThrow('Permission denied: update on opportunity')
  })

  it('reads owner from nested { id } shapes', () => {
    expect(readRecordOwnerId({ user_created: { id: 'u1' } })).toBe('u1')
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
        { user_created: 'u2' },
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
        { user_created: 'u2' },
        'update',
      ),
    ).rejects.toThrow('Permission denied: update on opportunity')
  })
})
