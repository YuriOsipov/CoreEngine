import { describe, expect, it } from 'vitest'
import {
  generateOidcNonce,
  generateOidcState,
  generatePkcePair,
} from './oidcPkce.js'
import {
  resetOidcStateStores,
  storeOidcPending,
  storeOidcSessionTicket,
  takeOidcPending,
  takeOidcSessionTicket,
} from './oidcStateStore.js'
import { redeemOidcTicket } from './oidcAuth.js'

describe('oidcPkce + state store', () => {
  it('generates distinct PKCE verifier/challenge and state', () => {
    const a = generatePkcePair()
    const b = generatePkcePair()
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.challenge).toHaveLength(43)
    expect(generateOidcState()).not.toBe(generateOidcNonce())
  })

  it('consumes pending state once', () => {
    resetOidcStateStores()
    storeOidcPending('state-1', {
      codeVerifier: 'v',
      nonce: 'n',
      redirectPath: '/setup',
    })
    expect(takeOidcPending('state-1')?.redirectPath).toBe('/setup')
    expect(takeOidcPending('state-1')).toBeNull()
  })

  it('redeems session tickets once', () => {
    resetOidcStateStores()
    storeOidcSessionTicket('ticket-1', {
      access_token: 'a',
      refresh_token: 'r',
      expires: 900,
    })
    const first = redeemOidcTicket('ticket-1')
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.session.access_token).toBe('a')
    }
    expect(redeemOidcTicket('ticket-1').ok).toBe(false)
    expect(takeOidcSessionTicket('ticket-1')).toBeNull()
  })
})
