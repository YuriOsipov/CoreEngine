import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}))

vi.mock('./oidcSessionCheck.js', () => ({
  oidcCheckOnRefreshEnabled: vi.fn(),
}))

import { query } from '../db/pool.js'
import { oidcCheckOnRefreshEnabled } from './oidcSessionCheck.js'
import { assertOidcRefreshTokenSchemaReady } from './oidcSchemaGate.js'

const mockedQuery = vi.mocked(query)
const mockedCheckOn = vi.mocked(oidcCheckOnRefreshEnabled)

describe('assertOidcRefreshTokenSchemaReady', () => {
  beforeEach(() => {
    mockedQuery.mockReset()
    mockedCheckOn.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('skips when refresh-time IdP check is off', async () => {
    mockedCheckOn.mockReturnValue(false)
    await expect(assertOidcRefreshTokenSchemaReady()).resolves.toBeUndefined()
    expect(mockedQuery).not.toHaveBeenCalled()
  })

  it('passes when oidc_* columns exist', async () => {
    mockedCheckOn.mockReturnValue(true)
    mockedQuery.mockResolvedValue([])
    await expect(assertOidcRefreshTokenSchemaReady()).resolves.toBeUndefined()
    expect(mockedQuery).toHaveBeenCalledOnce()
  })

  it('refuses boot when oidc_* columns are missing', async () => {
    mockedCheckOn.mockReturnValue(true)
    mockedQuery.mockRejectedValue(
      Object.assign(new Error('column does not exist'), { code: '42703' }),
    )
    await expect(assertOidcRefreshTokenSchemaReady()).rejects.toThrow(
      /202611170001.*202611170003/s,
    )
  })

  it('refuses boot when consumed table is missing', async () => {
    mockedCheckOn.mockReturnValue(true)
    mockedQuery.mockRejectedValue(
      Object.assign(new Error('relation does not exist'), { code: '42P01' }),
    )
    await expect(assertOidcRefreshTokenSchemaReady()).rejects.toThrow(
      /OIDC_CHECK_ON_REFRESH requires oidc_\*/,
    )
  })
})
