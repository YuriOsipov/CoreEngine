import { describe, expect, it } from 'vitest'
import { oidcPublicErrorCode } from './oidcPublicErrors.js'

describe('oidcPublicErrorCode', () => {
  it('never echoes account-existence detail', () => {
    expect(
      oidcPublicErrorCode({
        status: 403,
        error: 'Email is already linked to another SSO identity',
      }),
    ).toBe('sso_failed')
    expect(
      oidcPublicErrorCode({
        status: 401,
        error: 'OIDC token exchange failed: invalid_grant',
      }),
    ).toBe('sso_denied')
    expect(
      oidcPublicErrorCode({
        status: 503,
        error: 'SSO temporarily unavailable (too many pending logins)',
      }),
    ).toBe('sso_unavailable')
  })
})
