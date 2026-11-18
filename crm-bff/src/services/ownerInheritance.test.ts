import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveInheritOwnerFrom = vi.fn()
const loadM2ORelations = vi.fn()
const resolveRecordsStore = vi.fn()

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

import { resolveCreateOwnerId } from './ownerInheritance.js'

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
