import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}))

import { query } from '../db/pool.js'
import {
  bumpCacheEpoch,
  readCacheEpoch,
  resetLocalCacheEpochsForTests,
} from './cacheEpoch.js'

const queryMock = query as unknown as ReturnType<typeof vi.fn>

describe('cacheEpoch', () => {
  afterEach(() => {
    resetLocalCacheEpochsForTests()
    queryMock.mockReset()
  })

  it('reads epoch from the database', async () => {
    queryMock.mockResolvedValueOnce([{ epoch: 7 }])
    await expect(readCacheEpoch('field_security')).resolves.toBe(7)
  })

  it('falls back to local epoch when the table is missing', async () => {
    queryMock.mockRejectedValueOnce(new Error('relation missing'))
    await expect(readCacheEpoch('field_security')).resolves.toBe(1)
    await bumpCacheEpoch('field_security')
    queryMock.mockRejectedValueOnce(new Error('relation missing'))
    await expect(readCacheEpoch('field_security')).resolves.toBe(2)
  })

  it('bumps epoch via upsert', async () => {
    queryMock.mockResolvedValueOnce([{ epoch: 3 }])
    await expect(bumpCacheEpoch('row_level_security')).resolves.toBe(3)
  })
})
