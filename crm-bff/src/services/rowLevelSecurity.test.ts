import { describe, expect, it } from 'vitest'
import type { MeUser } from '../adapters/usersAdapter.js'
import { SYSTEM_RECORD_ACCESS } from '../adapters/records/types.js'
import {
  assertRecordOwner,
  bypassesRowLevelSecurity,
  mergeOwnerFilter,
  ownerEqFilter,
  parseRowLevelSecurity,
  readRecordOwnerId,
  readRowLevelSecurity,
  ROW_OWNER_FIELD,
} from './rowLevelSecurity.js'

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
