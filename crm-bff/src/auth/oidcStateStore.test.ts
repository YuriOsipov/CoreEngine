import { beforeEach, describe, expect, it } from 'vitest'
import {
  oidcPendingStoreSize,
  oidcStoreCaps,
  resetOidcStateStores,
  storeOidcPending,
} from './oidcStateStore.js'

describe('oidcStateStore', () => {
  beforeEach(() => {
    resetOidcStateStores()
  })

  it('rejects new pending entries when at capacity', () => {
    const { maxPending } = oidcStoreCaps()
    for (let i = 0; i < maxPending; i += 1) {
      const ok = storeOidcPending(`state-${i}`, {
        codeVerifier: 'v',
        nonce: 'n',
        redirectPath: '/',
      })
      expect(ok).toBe(true)
    }
    expect(oidcPendingStoreSize()).toBe(maxPending)
    expect(
      storeOidcPending('overflow', {
        codeVerifier: 'v',
        nonce: 'n',
        redirectPath: '/',
      }),
    ).toBe(false)
  })
})
