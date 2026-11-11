import { randomBytes, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MAX_PASSWORD_LENGTH,
  hashPassword,
  passwordNeedsRehash,
  passwordPolicyError,
  verifyPassword,
} from './passwords.js'

describe('passwords', () => {
  it('hashes with explicit params and verifies', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash).toMatch(/^scrypt\$32768\$8\$3:/)
    expect(await verifyPassword('correct horse battery', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
    expect(passwordNeedsRehash(hash)).toBe(false)
  })

  it('still verifies legacy default-cost hashes and flags them for rehash', async () => {
    const salt = randomBytes(16)
    const key = scryptSync('legacy-pass-123', salt, 64)
    const legacy = `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`
    expect(await verifyPassword('legacy-pass-123', legacy)).toBe(true)
    expect(passwordNeedsRehash(legacy)).toBe(true)
  })

  it('enforces min/max length and the insecure list', () => {
    expect(passwordPolicyError('short')).toMatch(/at least/)
    expect(passwordPolicyError('x'.repeat(MAX_PASSWORD_LENGTH + 1))).toMatch(/at most/)
    expect(passwordPolicyError('admin12345')).toMatch(/insecure/)
    expect(passwordPolicyError('a-unique-Passphrase-42')).toBeNull()
  })

  it('rejects over-long passwords without hashing', async () => {
    const hash = await hashPassword('reasonable-password')
    expect(await verifyPassword('x'.repeat(MAX_PASSWORD_LENGTH + 1), hash)).toBe(false)
  })
})
