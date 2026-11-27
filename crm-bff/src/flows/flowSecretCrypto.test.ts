import { afterEach, describe, expect, it } from 'vitest'
import {
  FLOW_SECRET_PREFIX,
  isSealedFlowSecret,
  openFlowSecret,
  sealFlowSecret,
} from './flowSecretCrypto.js'

describe('flowSecretCrypto', () => {
  afterEach(() => {
    delete process.env.FLOWS_SECRET_ENCRYPTION_KEY
    delete process.env.AUTH_JWT_SECRET
    delete process.env.JWT_SECRET
  })

  it('round-trips with AUTH_JWT_SECRET-derived key', () => {
    process.env.AUTH_JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
    const sealed = sealFlowSecret('super-secret-token')
    expect(sealed.startsWith(FLOW_SECRET_PREFIX)).toBe(true)
    expect(isSealedFlowSecret(sealed)).toBe(true)
    expect(openFlowSecret(sealed)).toBe('super-secret-token')
  })

  it('leaves legacy plaintext readable until resealed', () => {
    process.env.AUTH_JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
    expect(openFlowSecret('legacy-plain')).toBe('legacy-plain')
  })

  it('does not double-seal', () => {
    process.env.AUTH_JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
    const once = sealFlowSecret('abc')
    expect(sealFlowSecret(once)).toBe(once)
  })
})
