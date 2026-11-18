import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./localLogin.js', () => ({
  isLocalLoginEnabled: vi.fn(),
}))

import { isLocalLoginEnabled } from './localLogin.js'
import {
  LOCAL_LOGIN_DISABLED_ERROR,
  localLoginHttpGuard,
} from './localLoginHttp.js'
import { oidcStatusPayload } from './oidcAuth.js'

vi.mock('./oidcConfig.js', () => ({
  readOidcConfig: () => ({
    enabled: true,
    displayName: 'Keycloak',
    issuer: 'http://idp',
    clientId: 'coreengine',
    clientSecret: '',
    redirectUri: 'http://localhost/callback',
    uiOrigin: 'http://localhost',
    scopes: 'openid',
    jitProvision: false,
    defaultRoleBackendId: '',
    allowedEmailDomains: [],
    audience: '',
    internalIssuer: '',
  }),
}))

describe('local login off vs SSO / refresh contract', () => {
  afterEach(() => {
    vi.mocked(isLocalLoginEnabled).mockReset()
  })

  it('POST /auth/login guard returns 403 when local login is off', () => {
    vi.mocked(isLocalLoginEnabled).mockReturnValue(false)
    expect(localLoginHttpGuard()).toEqual({
      ok: false,
      status: 403,
      error: LOCAL_LOGIN_DISABLED_ERROR,
    })
  })

  it('allows login when local login is on', () => {
    vi.mocked(isLocalLoginEnabled).mockReturnValue(true)
    expect(localLoginHttpGuard()).toEqual({ ok: true })
  })

  it('OIDC status still reports enabled SSO when local login is off', () => {
    vi.mocked(isLocalLoginEnabled).mockReturnValue(false)
    const status = oidcStatusPayload()
    expect(status.enabled).toBe(true)
    expect(status.displayName).toBe('Keycloak')
    expect(status.localLoginEnabled).toBe(false)
  })

  it('documents that refresh does not use the local-login guard', async () => {
    // Refresh lives in localAuth.bffRefresh and is wired without localLoginHttpGuard
    // so SSO-only deploys can rotate sessions. Guard the invariant by source shape.
    const { readFileSync } = await import('node:fs')
    const { resolve, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = dirname(fileURLToPath(import.meta.url))
    const indexSrc = readFileSync(resolve(here, '../index.ts'), 'utf8')
    const loginBlock = indexSrc.slice(
      indexSrc.indexOf("app.post('/auth/login'"),
      indexSrc.indexOf("app.post('/auth/refresh'"),
    )
    const refreshBlock = indexSrc.slice(
      indexSrc.indexOf("app.post('/auth/refresh'"),
      indexSrc.indexOf("app.post('/auth/logout'"),
    )
    expect(loginBlock).toContain('localLoginHttpGuard')
    expect(refreshBlock).not.toContain('localLoginHttpGuard')
  })
})
