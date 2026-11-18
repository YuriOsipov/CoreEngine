import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}))

vi.mock('./oidcSessionCheck.js', () => ({
  oidcCheckOnRefreshEnabled: vi.fn(() => true),
  oidcDeactivateOnRejectEnabled: vi.fn(() => false),
  assertOidcSessionStillValid: vi.fn(),
}))

import { query } from '../db/pool.js'
import {
  assertOidcSessionStillValid,
  oidcCheckOnRefreshEnabled,
} from './oidcSessionCheck.js'
import { bffRefresh } from './localAuth.js'

const mockedQuery = vi.mocked(query)
const mockedAssertOidc = vi.mocked(assertOidcSessionStillValid)
const mockedCheckOn = vi.mocked(oidcCheckOnRefreshEnabled)

const USER_ID = '11111111-1111-4111-8111-111111111111'

const userRow = {
  id: USER_ID,
  backend_user_id: 'backend-1',
  email: 'user@example.com',
  is_active: true,
  role_backend_id: 'member',
  is_admin: false,
  password_hash: null,
  must_change_password: false,
}

function routeQuery(sql: string): unknown[] {
  // Must run before the consumed SELECT branch — consume SQL also mentions that table.
  if (sql.includes('WITH deleted AS')) {
    return [
      {
        user_id: USER_ID,
        oidc_access_token: 'idp-access',
        oidc_refresh_token: 'idp-refresh',
      },
    ]
  }
  if (sql.includes('FROM public.app_refresh_token_consumed') && sql.includes('SELECT')) {
    return []
  }
  if (
    sql.includes('FROM public.app_refresh_tokens') &&
    sql.includes('SELECT') &&
    !sql.includes('WITH deleted')
  ) {
    return [
      {
        user_id: USER_ID,
        oidc_access_token: 'idp-access',
        oidc_refresh_token: 'idp-refresh',
      },
    ]
  }
  if (sql.includes('FROM public.app_users')) {
    return [userRow]
  }
  // issueSession INSERT, prune UPDATE/DELETE, etc.
  return []
}

describe('bffRefresh single-flight', () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = 'test-jwt-secret-for-refresh-single-flight!!'
    process.env.OIDC_TOKEN_ENCRYPTION_KEY = 'test-oidc-seal-key'
    mockedCheckOn.mockReturnValue(true)
    mockedQuery.mockReset()
    mockedAssertOidc.mockReset()
    mockedQuery.mockImplementation(async (sql: string) => routeQuery(sql) as never)
  })

  afterEach(() => {
    delete process.env.AUTH_JWT_SECRET
    delete process.env.OIDC_TOKEN_ENCRYPTION_KEY
  })

  it('shares one IdP check and one session for concurrent refreshes of the same token', async () => {
    let idpCalls = 0
    mockedAssertOidc.mockImplementation(async () => {
      idpCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 40))
      return {
        ok: true as const,
        accessToken: 'rotated-access',
        refreshToken: 'rotated-refresh',
      }
    })

    const refreshToken = 'shared-ce-refresh-token'
    const [first, second] = await Promise.all([
      bffRefresh({ refreshToken }),
      bffRefresh({ refreshToken }),
    ])

    expect(idpCalls).toBe(1)
    expect(mockedAssertOidc).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.session.access_token).toBe(second.session.access_token)
      expect(first.session.refresh_token).toBe(second.session.refresh_token)
    }
  })
})
