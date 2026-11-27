import { afterEach, describe, expect, it } from 'vitest'
import {
  applyHttpFlowAuthHeaders,
  mergeHttpFlowAuth,
  openHttpFlowAuth,
  redactHttpFlowAuthForAdmin,
  sealHttpFlowAuth,
} from './httpFlowAuth.js'
import { FLOW_SECRET_PREFIX } from './flowSecretCrypto.js'

describe('httpFlowAuth at-rest secrets', () => {
  afterEach(() => {
    delete process.env.FLOWS_SECRET_ENCRYPTION_KEY
    delete process.env.AUTH_JWT_SECRET
    delete process.env.JWT_SECRET
  })

  it('seals bearer tokens and opens them for headers', () => {
    process.env.AUTH_JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
    const sealed = sealHttpFlowAuth({ type: 'bearer', token: 'tok-1' })
    expect(sealed.token?.startsWith(FLOW_SECRET_PREFIX)).toBe(true)
    const headers = applyHttpFlowAuthHeaders({}, sealed)
    expect(headers.Authorization).toBe('Bearer tok-1')
    expect(openHttpFlowAuth(sealed).token).toBe('tok-1')
  })

  it('keeps existing sealed secret when admin leaves the field blank', () => {
    process.env.AUTH_JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
    const existing = sealHttpFlowAuth({ type: 'bearer', token: 'keep-me' })
    const merged = mergeHttpFlowAuth({ type: 'bearer', token: '' }, existing)
    const resealed = sealHttpFlowAuth(merged)
    expect(openHttpFlowAuth(resealed).token).toBe('keep-me')
  })

  it('redacts secrets for admin list responses', () => {
    process.env.AUTH_JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
    const sealed = sealHttpFlowAuth({ type: 'bearer', token: 'tok-1' })
    const redacted = redactHttpFlowAuthForAdmin(sealed)
    expect(redacted).toEqual({ type: 'bearer', token: '', tokenSet: true })
  })
})
