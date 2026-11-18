import { afterEach, describe, expect, it } from 'vitest'
import { isLocalLoginEnabled } from './localLogin.js'

describe('isLocalLoginEnabled', () => {
  const prev = process.env.AUTH_LOCAL_LOGIN_ENABLED

  afterEach(() => {
    if (prev === undefined) delete process.env.AUTH_LOCAL_LOGIN_ENABLED
    else process.env.AUTH_LOCAL_LOGIN_ENABLED = prev
  })

  it('defaults to enabled', () => {
    delete process.env.AUTH_LOCAL_LOGIN_ENABLED
    expect(isLocalLoginEnabled()).toBe(true)
  })

  it('disables on false/0/off/no', () => {
    for (const value of ['false', '0', 'off', 'no', 'FALSE']) {
      process.env.AUTH_LOCAL_LOGIN_ENABLED = value
      expect(isLocalLoginEnabled()).toBe(false)
    }
  })

  it('stays enabled on true/empty', () => {
    process.env.AUTH_LOCAL_LOGIN_ENABLED = 'true'
    expect(isLocalLoginEnabled()).toBe(true)
    process.env.AUTH_LOCAL_LOGIN_ENABLED = ''
    expect(isLocalLoginEnabled()).toBe(true)
  })
})
