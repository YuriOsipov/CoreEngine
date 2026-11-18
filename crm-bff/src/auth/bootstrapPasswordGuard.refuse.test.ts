import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const verifyPassword = vi.fn()

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
}))
vi.mock('./passwords.js', () => ({
  verifyPassword: (...args: unknown[]) => verifyPassword(...args),
}))

import { assertBootstrapPasswordsSafe } from './bootstrapPasswordGuard.js'

describe('assertBootstrapPasswordsSafe (admin12345)', () => {
  const prevAllow = process.env.ALLOW_INSECURE_BOOTSTRAP

  beforeEach(() => {
    delete process.env.ALLOW_INSECURE_BOOTSTRAP
    query.mockReset()
    verifyPassword.mockReset()
  })

  afterEach(() => {
    if (prevAllow === undefined) delete process.env.ALLOW_INSECURE_BOOTSTRAP
    else process.env.ALLOW_INSECURE_BOOTSTRAP = prevAllow
  })

  it('refuses to start when bootstrap admin still uses admin12345', async () => {
    query.mockResolvedValue([
      { email: 'admin@example.com', password_hash: 'hash' },
    ])
    verifyPassword.mockImplementation(async (candidate: string) => {
      return candidate === 'admin12345'
    })

    await expect(assertBootstrapPasswordsSafe()).rejects.toThrow(
      /Refusing to start: admin@example.com still uses a known insecure password/,
    )
  })

  it('allows start when bootstrap password is unique', async () => {
    query.mockResolvedValue([
      { email: 'admin@example.com', password_hash: 'hash' },
    ])
    verifyPassword.mockResolvedValue(false)
    await expect(assertBootstrapPasswordsSafe()).resolves.toBeUndefined()
  })
})
