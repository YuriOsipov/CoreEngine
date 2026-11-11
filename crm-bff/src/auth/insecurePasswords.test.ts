import { describe, expect, it } from 'vitest'
import {
  isInsecurePassword,
  KNOWN_INSECURE_PASSWORDS,
} from './insecurePasswords.js'

describe('isInsecurePassword', () => {
  it('flags documented defaults including admin12345', () => {
    expect(isInsecurePassword('admin12345')).toBe(true)
    expect(isInsecurePassword('ChangeMeNow!')).toBe(true)
    expect(isInsecurePassword('password')).toBe(true)
  })

  it('flags change-me style placeholders', () => {
    expect(isInsecurePassword('my-local-secret-change-me')).toBe(true)
    expect(isInsecurePassword('tmp-changeme')).toBe(true)
  })

  it('accepts unique secrets', () => {
    expect(isInsecurePassword('Xv9!kQm2-unique-local-admin')).toBe(false)
  })

  it('keeps the known list non-empty', () => {
    expect(KNOWN_INSECURE_PASSWORDS.length).toBeGreaterThan(0)
  })
})
