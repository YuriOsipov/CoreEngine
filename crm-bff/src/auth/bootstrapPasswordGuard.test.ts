import { afterEach, describe, expect, it } from 'vitest'
import { allowInsecureBootstrapPasswords } from './bootstrapPasswordGuard.js'

describe('allowInsecureBootstrapPasswords', () => {
  const prev = process.env.ALLOW_INSECURE_BOOTSTRAP

  afterEach(() => {
    if (prev === undefined) delete process.env.ALLOW_INSECURE_BOOTSTRAP
    else process.env.ALLOW_INSECURE_BOOTSTRAP = prev
  })

  it('defaults to false (always refuse weak bootstrap passwords)', () => {
    delete process.env.ALLOW_INSECURE_BOOTSTRAP
    expect(allowInsecureBootstrapPasswords()).toBe(false)
  })

  it('allows escape hatch', () => {
    process.env.ALLOW_INSECURE_BOOTSTRAP = 'true'
    expect(allowInsecureBootstrapPasswords()).toBe(true)
    process.env.ALLOW_INSECURE_BOOTSTRAP = '1'
    expect(allowInsecureBootstrapPasswords()).toBe(true)
  })
})
