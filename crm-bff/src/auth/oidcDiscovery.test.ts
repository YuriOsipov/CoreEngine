import { describe, expect, it } from 'vitest'
import { rewriteInternalUrl } from './oidcDiscovery.js'

describe('rewriteInternalUrl', () => {
  it('rewrites only on exact issuer or slash boundary', () => {
    expect(
      rewriteInternalUrl(
        'https://idp/realms/x/protocol/openid-connect/token',
        'https://idp',
        'http://keycloak:8080',
      ),
    ).toBe('http://keycloak:8080/realms/x/protocol/openid-connect/token')

    expect(
      rewriteInternalUrl(
        'https://idp.evil.com/realms/x/token',
        'https://idp',
        'http://keycloak:8080',
      ),
    ).toBe('https://idp.evil.com/realms/x/token')

    expect(
      rewriteInternalUrl('https://idp', 'https://idp', 'http://keycloak:8080'),
    ).toBe('http://keycloak:8080')
  })
})
