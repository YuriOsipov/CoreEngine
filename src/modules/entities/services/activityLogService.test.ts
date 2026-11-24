/**
 * Owner reassignment must surface as an Activity field delta (not only "Record updated").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readRecordActivitiesBridge = vi.fn()
const readRecordRevisionsBridge = vi.fn()
const getCachedCollectionFields = vi.fn()
const getCachedRelations = vi.fn()
const fetchRelatedCollectionOptionById = vi.fn()
const readUsersBridge = vi.fn()
const translateField = vi.fn(
  async (field: { field?: string; name?: string }) =>
    field.field === 'owner_id' ? 'Owner' : String(field.field ?? field.name ?? ''),
)

vi.mock('@/core/graphql/auditApi', async () => {
  const actual = await vi.importActual<typeof import('@/core/graphql/auditApi')>(
    '@/core/graphql/auditApi',
  )
  return {
    ...actual,
    readRecordActivitiesBridge: (...args: unknown[]) =>
      readRecordActivitiesBridge(...args),
    readRecordRevisionsBridge: (...args: unknown[]) =>
      readRecordRevisionsBridge(...args),
  }
})
vi.mock('./collectionSchema', () => ({
  getCachedCollectionFields: (...args: unknown[]) =>
    getCachedCollectionFields(...args),
  getCachedRelations: (...args: unknown[]) => getCachedRelations(...args),
  fetchRelatedCollectionOptionById: (...args: unknown[]) =>
    fetchRelatedCollectionOptionById(...args),
}))
vi.mock('@/core/graphql/usersApi', () => ({
  readUsersBridge: (...args: unknown[]) => readUsersBridge(...args),
}))
vi.mock('@/core/translation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/translation')>()
  return {
    ...actual,
    t: (_key: string, fallback?: string) => fallback ?? _key,
    translateField: (...args: unknown[]) => translateField(...args),
  }
})

import { fetchRecordActivityLog } from './activityLogService'

describe('activityLogService owner reassignment', () => {
  beforeEach(() => {
    readRecordActivitiesBridge.mockReset()
    readRecordRevisionsBridge.mockReset()
    getCachedCollectionFields.mockReset()
    getCachedRelations.mockReset()
    fetchRelatedCollectionOptionById.mockReset()
    readUsersBridge.mockReset()
    translateField.mockClear()

    getCachedCollectionFields.mockResolvedValue([
      {
        field: 'owner_id',
        name: 'Owner',
        type: 'uuid',
        meta: { interface: 'select-dropdown-m2o' },
      },
      {
        field: 'name',
        name: 'Name',
        type: 'string',
        meta: {},
      },
    ])
    getCachedRelations.mockResolvedValue([
      {
        collection: 'account',
        field: 'owner_id',
        related_collection: 'users',
        meta: {},
      },
    ])
    fetchRelatedCollectionOptionById.mockImplementation(
      async (_collection: string, id: string | number) => ({
        id: String(id),
        label: id === 'old-owner' ? 'Ada Owner' : 'Bea Owner',
      }),
    )
    readUsersBridge.mockResolvedValue([
      { id: 'actor-1', first_name: 'Pat', last_name: 'Admin' },
    ])
  })

  it('shows Owner change in Activity deltas from consecutive revision snapshots', async () => {
    readRecordRevisionsBridge.mockResolvedValue([
      {
        id: 1,
        data: { id: 'rec-1', name: 'Acme', owner_id: 'old-owner' },
        parent: null,
      },
      {
        id: 2,
        data: { id: 'rec-1', name: 'Acme', owner_id: 'new-owner' },
        parent: 1,
      },
    ])
    readRecordActivitiesBridge.mockResolvedValue({
      nodes: [
        {
          id: 10,
          action: 'update',
          timestamp: '2026-11-24T10:00:00.000Z',
          user: { id: 'actor-1' },
          comment: null,
          revisions: [{ id: 2 }],
        },
      ],
      totalCount: 1,
    })

    const entries = await fetchRecordActivityLog({
      collection: 'account',
      recordId: 'rec-1',
      settings: { showDeltas: true, maxItems: 20, actions: ['update'] },
    })

    expect(entries).toHaveLength(1)
    const ownerDelta = entries[0]!.deltas.find((d) => d.field === 'owner_id')
    expect(ownerDelta).toBeTruthy()
    expect(ownerDelta!.label).toBe('Owner')
    expect(ownerDelta!.previousPreview).toMatch(/Ada Owner|old-owner/)
    expect(ownerDelta!.valuePreview).toMatch(/Bea Owner|new-owner/)
    expect(entries[0]!.summary).not.toBe('Record updated')
  })
})
