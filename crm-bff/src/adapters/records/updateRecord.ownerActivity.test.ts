/**
 * Change Owner → audit `after` must include the new owner_id.
 * Strip/re-add happens inside the write; revision snapshot is the post-update row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveRecordsStore = vi.fn()
const resolveOwnerReassignment = vi.fn()
const loadPromotedFields = vi.fn()
const resolveFieldAccess = vi.fn()
const assertOwnerAccessIfNeeded = vi.fn()
const loadM2ORelations = vi.fn()
const loadM2ARelations = vi.fn()
const loadO2MRelations = vi.fn()
const loadRollupFields = vi.fn()
const attachLiveRollupsOnRead = vi.fn(
  async (
    _entity: string,
    nodes: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> => nodes,
)
const scheduleAutomationFlows = vi.fn()
const recomputeRollupsForChildChange = vi.fn()
const applyM2ANestedWrites = vi.fn()
const applyO2MNestedWrites = vi.fn()

vi.mock('./registry.js', () => ({
  resolveRecordsStore: (...args: unknown[]) => resolveRecordsStore(...args),
}))
vi.mock('./entityName.js', () => ({
  resolveCanonicalEntityApiName: async (entity: string) => entity,
}))
vi.mock('../../services/ownerInheritance.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/ownerInheritance.js')
  >('../../services/ownerInheritance.js')
  return {
    ...actual,
    resolveOwnerReassignment: (...args: unknown[]) =>
      resolveOwnerReassignment(...args),
  }
})
vi.mock('../../services/rowLevelSecurity.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/rowLevelSecurity.js')
  >('../../services/rowLevelSecurity.js')
  return {
    ...actual,
    assertOwnerAccessIfNeeded: (...args: unknown[]) =>
      assertOwnerAccessIfNeeded(...args),
    ownerAccessCheckFields: async () => ['owner_id', 'user_created'],
  }
})
vi.mock('../../services/fieldSecurity.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/fieldSecurity.js')
  >('../../services/fieldSecurity.js')
  return {
    ...actual,
    resolveFieldAccess: (...args: unknown[]) => resolveFieldAccess(...args),
    assertPayloadWritable: vi.fn(),
    assertFieldsEditable: vi.fn(),
  }
})
vi.mock('../../schema/crmStorage.js', async () => {
  const actual = await vi.importActual<typeof import('../../schema/crmStorage.js')>(
    '../../schema/crmStorage.js',
  )
  return {
    ...actual,
    loadPromotedFields: (...args: unknown[]) => loadPromotedFields(...args),
  }
})
vi.mock('./relations.js', async () => {
  const actual = await vi.importActual<typeof import('./relations.js')>(
    './relations.js',
  )
  return {
    ...actual,
    loadM2ORelations: (...args: unknown[]) => loadM2ORelations(...args),
    loadM2ARelations: (...args: unknown[]) => loadM2ARelations(...args),
    loadO2MRelations: (...args: unknown[]) => loadO2MRelations(...args),
    loadReverseM2OChildren: async () => [],
  }
})
vi.mock('../../computed/fieldMeta.js', async () => {
  const actual = await vi.importActual<typeof import('../../computed/fieldMeta.js')>(
    '../../computed/fieldMeta.js',
  )
  return {
    ...actual,
    loadRollupFields: (...args: unknown[]) => loadRollupFields(...args),
  }
})
vi.mock('../../computed/applyRollups.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../computed/applyRollups.js')
  >('../../computed/applyRollups.js')
  return {
    ...actual,
    attachLiveRollupsOnRead: (...args: unknown[]) =>
      attachLiveRollupsOnRead(...args),
    recomputeRollupsForChildChange: (...args: unknown[]) =>
      recomputeRollupsForChildChange(...args),
  }
})
vi.mock('../../computed/applyFormulas.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../computed/applyFormulas.js')
  >('../../computed/applyFormulas.js')
  return {
    ...actual,
    applyFormulasOnWrite: async (
      _entity: string,
      data: Record<string, unknown>,
    ) => data,
    stripRollupWrites: async (
      _entity: string,
      data: Record<string, unknown>,
    ) => data,
  }
})
vi.mock('../../computed/sanitizeHtmlFields.js', () => ({
  sanitizeHtmlFieldWrites: async (
    _entity: string,
    data: Record<string, unknown>,
  ) => data,
}))
vi.mock('../../computed/applyAutoNumber.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../computed/applyAutoNumber.js')
  >('../../computed/applyAutoNumber.js')
  return {
    ...actual,
    stripAutoNumberWrites: async (
      _entity: string,
      data: Record<string, unknown>,
    ) => data,
  }
})
vi.mock('../../computed/applyRecordAutomations.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../computed/applyRecordAutomations.js')
  >('../../computed/applyRecordAutomations.js')
  return {
    ...actual,
    applyRecordAutomations: async (
      _entity: string,
      patch: Record<string, unknown>,
    ) => ({
      patch: { ...patch },
      toasts: [],
      stopped: false,
      flowTriggers: [],
    }),
  }
})
vi.mock('../../computed/dispatchAutomationFlows.js', () => ({
  scheduleAutomationFlows: (...args: unknown[]) =>
    scheduleAutomationFlows(...args),
}))
vi.mock('./m2aNestedWrite.js', async () => {
  const actual = await vi.importActual<typeof import('./m2aNestedWrite.js')>(
    './m2aNestedWrite.js',
  )
  return {
    ...actual,
    peelM2AAliasFields: async (
      _entity: string,
      data: Record<string, unknown>,
    ) => ({ parentData: data, nested: new Map() }),
    applyM2ANestedWrites: (...args: unknown[]) => applyM2ANestedWrites(...args),
  }
})
vi.mock('./o2mNestedWrite.js', async () => {
  const actual = await vi.importActual<typeof import('./o2mNestedWrite.js')>(
    './o2mNestedWrite.js',
  )
  return {
    ...actual,
    peelO2MAliasFields: async (
      _entity: string,
      data: Record<string, unknown>,
    ) => ({ parentData: data, nested: new Map() }),
    applyO2MNestedWrites: (...args: unknown[]) => applyO2MNestedWrites(...args),
  }
})

import { updateRecord } from './facade.js'
import { SYSTEM_RECORD_ACCESS } from './types.js'

describe('updateRecord owner reassignment → audit after', () => {
  beforeEach(() => {
    resolveRecordsStore.mockReset()
    resolveOwnerReassignment.mockReset()
    loadPromotedFields.mockReset()
    resolveFieldAccess.mockReset()
    assertOwnerAccessIfNeeded.mockReset()
    loadM2ORelations.mockReset()
    loadM2ARelations.mockReset()
    loadO2MRelations.mockReset()
    loadRollupFields.mockReset()
    attachLiveRollupsOnRead.mockClear()
    scheduleAutomationFlows.mockReset()
    recomputeRollupsForChildChange.mockReset()
    applyM2ANestedWrites.mockReset()
    applyO2MNestedWrites.mockReset()

    loadPromotedFields.mockResolvedValue([
      { apiName: 'owner_id' },
      { apiName: 'user_updated' },
      { apiName: 'date_updated' },
    ])
    resolveFieldAccess.mockResolvedValue(null)
    assertOwnerAccessIfNeeded.mockResolvedValue(undefined)
    loadM2ORelations.mockResolvedValue([])
    loadM2ARelations.mockResolvedValue([])
    loadO2MRelations.mockResolvedValue([])
    loadRollupFields.mockResolvedValue([])
    resolveOwnerReassignment.mockResolvedValue('new-owner')
  })

  it('writes and returns the new owner_id so revision/activity after includes reassignment', async () => {
    const existing = {
      id: 'rec-1',
      name: 'Acme',
      owner_id: 'old-owner',
    }
    let stored = { ...existing }
    const findOne = vi.fn(async () => ({ ...stored }))
    const update = vi.fn(
      async (
        _entity: string,
        _id: string,
        data: Record<string, unknown>,
      ) => {
        stored = { ...stored, ...data }
        return { ...stored }
      },
    )
    resolveRecordsStore.mockResolvedValue({ findOne, update })

    const after = await updateRecord(
      'account',
      'rec-1',
      { owner_id: 'new-owner' },
      null,
      { actorUserId: 'admin-1', access: SYSTEM_RECORD_ACCESS },
    )

    expect(resolveOwnerReassignment).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(
      'account',
      'rec-1',
      expect.objectContaining({ owner_id: 'new-owner' }),
      null,
    )
    // Same object GraphQL/REST pass to writeEntityAudit as `after`.
    expect(after.owner_id).toBe('new-owner')
  })
})
