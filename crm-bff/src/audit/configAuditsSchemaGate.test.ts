import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}))

import { query } from '../db/pool.js'
import {
  assertConfigAuditsAppendOnlyReady,
  CONFIG_AUDITS_APPEND_ONLY_TRIGGERS,
} from './configAuditsSchemaGate.js'

const mockedQuery = vi.mocked(query)

describe('assertConfigAuditsAppendOnlyReady', () => {
  const prevEnv = process.env.NODE_ENV

  beforeEach(() => {
    mockedQuery.mockReset()
    process.env.NODE_ENV = 'development'
  })

  afterEach(() => {
    process.env.NODE_ENV = prevEnv
    vi.clearAllMocks()
  })

  it('skips when the table is missing outside production', async () => {
    mockedQuery.mockResolvedValueOnce([{ present: false }])
    await expect(assertConfigAuditsAppendOnlyReady()).resolves.toBeUndefined()
    expect(mockedQuery).toHaveBeenCalledTimes(1)
  })

  it('refuses production boot when the table is missing', async () => {
    process.env.NODE_ENV = 'production'
    mockedQuery.mockResolvedValueOnce([{ present: false }])
    await expect(assertConfigAuditsAppendOnlyReady()).rejects.toThrow(
      /public\.config_audits is missing/i,
    )
  })

  it('refuses when requireTable is set and the table is missing', async () => {
    mockedQuery.mockResolvedValueOnce([{ present: false }])
    await expect(
      assertConfigAuditsAppendOnlyReady({ requireTable: true }),
    ).rejects.toThrow(/public\.config_audits is missing/i)
  })

  it('passes when both append-only triggers exist', async () => {
    mockedQuery
      .mockResolvedValueOnce([{ present: true }])
      .mockResolvedValueOnce(
        CONFIG_AUDITS_APPEND_ONLY_TRIGGERS.map((tgname) => ({ tgname })),
      )
    await expect(assertConfigAuditsAppendOnlyReady()).resolves.toBeUndefined()
    expect(mockedQuery).toHaveBeenCalledTimes(2)
  })

  it('refuses when a trigger was silently skipped', async () => {
    mockedQuery
      .mockResolvedValueOnce([{ present: true }])
      .mockResolvedValueOnce([{ tgname: 'config_audits_append_only' }])
    await expect(assertConfigAuditsAppendOnlyReady()).rejects.toThrow(
      /config_audits_append_only_truncate.*RAISE NOTICE/is,
    )
  })
})
