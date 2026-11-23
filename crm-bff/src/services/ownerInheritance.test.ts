import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveInheritOwnerFrom = vi.fn()
const loadM2ORelations = vi.fn()
const resolveRecordsStore = vi.fn()
const resolveRoleOwnerBypass = vi.fn()

vi.mock('./rowLevelSecurity.js', async () => {
  const actual = await vi.importActual<typeof import('./rowLevelSecurity.js')>(
    './rowLevelSecurity.js',
  )
  return {
    ...actual,
    resolveInheritOwnerFrom: (...args: unknown[]) =>
      resolveInheritOwnerFrom(...args),
  }
})
vi.mock('./rolePermissions.js', async () => {
  const actual = await vi.importActual<typeof import('./rolePermissions.js')>(
    './rolePermissions.js',
  )
  return {
    ...actual,
    resolveRoleOwnerBypass: (...args: unknown[]) =>
      resolveRoleOwnerBypass(...args),
  }
})
vi.mock('../adapters/records/relations.js', async () => {
  const actual = await vi.importActual<
    typeof import('../adapters/records/relations.js')
  >('../adapters/records/relations.js')
  return {
    ...actual,
    loadM2ORelations: (...args: unknown[]) => loadM2ORelations(...args),
  }
})
vi.mock('../adapters/records/registry.js', () => ({
  resolveRecordsStore: (...args: unknown[]) => resolveRecordsStore(...args),
}))

import {
  canAssignOwnerOnCreate,
  canAssignOwnerOnUpdate,
  resolveCreateOwnerId,
  resolveEffectiveCreateOwnerId,
} from './ownerInheritance.js'
import { SYSTEM_RECORD_ACCESS } from '../adapters/records/types.js'

describe('resolveCreateOwnerId (rep + manager add items)', () => {
  beforeEach(() => {
    resolveInheritOwnerFrom.mockReset()
    loadM2ORelations.mockReset()
    resolveRecordsStore.mockReset()
  })

  it('stamps the parent opportunity owner for both rep and manager creates', async () => {
    resolveInheritOwnerFrom.mockResolvedValue('opportunity')
    loadM2ORelations.mockResolvedValue([
      {
        fieldApiName: 'opportunity',
        relatedEntityApiName: 'opportunity',
      },
    ])
    const findOne = vi.fn().mockResolvedValue({
      id: 'opp-1',
      owner_id: 'rep-owner',
    })
    resolveRecordsStore.mockResolvedValue({ findOne })

    const asRep = await resolveCreateOwnerId(
      'opportunity_item',
      { opportunity: 'opp-1', name: 'Line A' },
      'rep-owner',
    )
    const asManager = await resolveCreateOwnerId(
      'opportunity_item',
      { opportunity: 'opp-1', name: 'Line B' },
      'manager-actor',
    )

    expect(asRep).toBe('rep-owner')
    expect(asManager).toBe('rep-owner')
    expect(findOne).toHaveBeenCalledWith('opportunity', 'opp-1', [
      'owner_id',
    ])
  })

  it('falls back to actor when inheritance is off', async () => {
    resolveInheritOwnerFrom.mockResolvedValue(null)
    await expect(
      resolveCreateOwnerId('opportunity_item', { opportunity: 'opp-1' }, 'mgr'),
    ).resolves.toBe('mgr')
    expect(loadM2ORelations).not.toHaveBeenCalled()
  })
})

describe('resolveEffectiveCreateOwnerId (trusted owner assign)', () => {
  beforeEach(() => {
    resolveInheritOwnerFrom.mockReset()
    loadM2ORelations.mockReset()
    resolveRecordsStore.mockReset()
    resolveRoleOwnerBypass.mockReset()
  })

  it('uses requested owner_id when caller has Modify all', async () => {
    resolveInheritOwnerFrom.mockResolvedValue(null)
    resolveRoleOwnerBypass.mockResolvedValue({
      viewAll: true,
      modifyAll: true,
    })
    const owner = await resolveEffectiveCreateOwnerId(
      'incoming_message',
      { subject: 'Hi' },
      {
        me: {
          id: 'integration',
          email: 'n8n@example.com',
          isAdmin: false,
        } as never,
      },
      'integration',
      'recipient-user',
    )
    expect(owner).toBe('recipient-user')
  })

  it('ignores requested owner_id without Modify all', async () => {
    resolveInheritOwnerFrom.mockResolvedValue(null)
    resolveRoleOwnerBypass.mockResolvedValue({
      viewAll: false,
      modifyAll: false,
    })
    const owner = await resolveEffectiveCreateOwnerId(
      'incoming_message',
      { subject: 'Hi', owner_id: 'recipient-user' },
      {
        me: {
          id: 'rep',
          email: 'rep@example.com',
          isAdmin: false,
        } as never,
      },
      'rep',
      'recipient-user',
    )
    expect(owner).toBe('rep')
  })

  it('allows system access to assign owner', async () => {
    expect(await canAssignOwnerOnCreate(SYSTEM_RECORD_ACCESS, 'incoming_message')).toBe(
      true,
    )
  })
})

describe('canAssignOwnerOnUpdate (transfer)', () => {
  beforeEach(() => {
    resolveRoleOwnerBypass.mockReset()
  })

  it('allows Modify all to reassign any row', async () => {
    resolveRoleOwnerBypass.mockResolvedValue({
      viewAll: true,
      modifyAll: true,
    })
    await expect(
      canAssignOwnerOnUpdate(
        {
          me: {
            id: 'mgr',
            email: 'mgr@example.com',
            isAdmin: false,
          } as never,
        },
        'account',
        'rep-owner',
      ),
    ).resolves.toBe(true)
  })

  it('allows the current owner to transfer their own row', async () => {
    resolveRoleOwnerBypass.mockResolvedValue({
      viewAll: false,
      modifyAll: false,
    })
    await expect(
      canAssignOwnerOnUpdate(
        {
          me: {
            id: 'rep-owner',
            email: 'rep@example.com',
            isAdmin: false,
          } as never,
        },
        'account',
        'rep-owner',
      ),
    ).resolves.toBe(true)
  })

  it('denies a peer without Modify all', async () => {
    resolveRoleOwnerBypass.mockResolvedValue({
      viewAll: false,
      modifyAll: false,
    })
    await expect(
      canAssignOwnerOnUpdate(
        {
          me: {
            id: 'other-rep',
            email: 'other@example.com',
            isAdmin: false,
          } as never,
        },
        'account',
        'rep-owner',
      ),
    ).resolves.toBe(false)
  })
})
