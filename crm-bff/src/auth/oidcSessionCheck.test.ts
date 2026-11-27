import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./oidcDiscovery.js', () => ({
  fetchOidcDiscovery: vi.fn(async () => ({
    userinfo_endpoint: 'http://idp.test/userinfo',
    token_endpoint: 'http://idp.test/token',
  })),
}))

vi.mock('./oidcFetch.js', () => ({
  fetchOidcHttp: vi.fn(),
}))

vi.mock('./oidcConfig.js', () => ({
  readOidcConfig: vi.fn(() => ({
    enabled: true,
    clientId: 'coreengine',
    clientSecret: 'secret',
  })),
}))

import { fetchOidcHttp } from './oidcFetch.js'
import {
  assertOidcSessionStillValid,
  oidcCheckOnRefreshEnabled,
} from './oidcSessionCheck.js'

const fetchMock = fetchOidcHttp as unknown as ReturnType<typeof vi.fn>

describe('oidcSessionCheck', () => {
  afterEach(() => {
    delete process.env.OIDC_CHECK_ON_REFRESH
    fetchMock.mockReset()
  })

  it('defaults check-on-refresh to enabled', () => {
    expect(oidcCheckOnRefreshEnabled()).toBe(true)
  })

  it('skips when no IdP tokens are stored', async () => {
    const result = await assertOidcSessionStillValid({})
    expect(result).toEqual({ ok: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a valid userinfo response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })
    const result = await assertOidcSessionStillValid({
      oidcAccessToken: 'access-1',
    })
    expect(result).toEqual({
      ok: true,
      accessToken: 'access-1',
      refreshToken: undefined,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('skips revoke when access fails and no IdP refresh token exists', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 })
    const result = await assertOidcSessionStillValid({
      oidcAccessToken: 'stale',
    })
    expect(result).toEqual({ ok: true })
  })

  it('rejects when userinfo and refresh both fail', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
    const result = await assertOidcSessionStillValid({
      oidcAccessToken: 'stale',
      oidcRefreshToken: 'refresh-1',
    })
    expect(result).toEqual({
      ok: false,
      reason: 'IdP rejected SSO session (userinfo/refresh failed)',
    })
  })

  it('throws on userinfo 429 so CE refresh is not revoked', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(
      assertOidcSessionStillValid({
        oidcAccessToken: 'access-1',
        oidcRefreshToken: 'refresh-1',
      }),
    ).rejects.toMatchObject({ name: 'OidcIdpUnavailableError', status: 429 })
  })

  it('throws on IdP token refresh 5xx so CE refresh is not revoked', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(
      assertOidcSessionStillValid({
        oidcAccessToken: 'stale',
        oidcRefreshToken: 'refresh-1',
      }),
    ).rejects.toMatchObject({ name: 'OidcIdpUnavailableError', status: 503 })
  })

  it('rotates IdP access via refresh then rechecks userinfo', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 })
    const result = await assertOidcSessionStillValid({
      oidcAccessToken: 'stale',
      oidcRefreshToken: 'refresh-1',
    })
    expect(result).toEqual({
      ok: true,
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    })
  })
})
