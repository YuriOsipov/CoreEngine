import { describe, expect, it } from 'vitest'
import {
  buildOidcStateClearCookie,
  buildOidcStateSetCookie,
  hashOidcState,
  OIDC_STATE_COOKIE,
  oidcStateCookieMatches,
  readRequestCookie,
} from './oidcStateCookie.js'

describe('oidcStateCookie', () => {
  it('binds cookie value to a hash of state', () => {
    const state = 'abc.STATE-value'
    const setCookie = buildOidcStateSetCookie(state, { secure: false })
    expect(setCookie).toContain(`${OIDC_STATE_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/auth/oidc')
    expect(setCookie).not.toContain('Secure')
    expect(oidcStateCookieMatches(state, hashOidcState(state))).toBe(true)
    expect(oidcStateCookieMatches(state, 'deadbeef')).toBe(false)
    expect(oidcStateCookieMatches(state, null)).toBe(false)
  })

  it('adds Secure when requested and clears with Max-Age=0', () => {
    expect(buildOidcStateSetCookie('s', { secure: true })).toContain('Secure')
    const clear = buildOidcStateClearCookie({ secure: true })
    expect(clear).toContain('Max-Age=0')
    expect(clear).toContain('Secure')
  })

  it('parses the named cookie from Cookie header', () => {
    const state = 'xyz'
    const header = `a=1; ${OIDC_STATE_COOKIE}=${hashOidcState(state)}; b=2`
    expect(readRequestCookie(header, OIDC_STATE_COOKIE)).toBe(hashOidcState(state))
  })
})
