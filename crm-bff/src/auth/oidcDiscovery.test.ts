import { describe, expect, it } from 'vitest'
import {
  assertDiscoveryEndpointOrigins,
  rewriteInternalUrl,
} from './oidcDiscovery.js'

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

describe('assertDiscoveryEndpointOrigins', () => {
  it('allows endpoints on the issuer origin', () => {
    expect(() =>
      assertDiscoveryEndpointOrigins(
        {
          authorization_endpoint: 'https://idp.example/auth',
          token_endpoint: 'https://idp.example/token',
          jwks_uri: 'https://idp.example/jwks',
        },
        ['https://idp.example/realms/x'],
      ),
    ).not.toThrow()
  })

  it('allows dual-host public + internal issuers', () => {
    expect(() =>
      assertDiscoveryEndpointOrigins(
        {
          authorization_endpoint: 'https://sso.example/auth',
          token_endpoint: 'http://keycloak:8080/token',
          jwks_uri: 'http://keycloak:8080/jwks',
        },
        ['https://sso.example/realms/x', 'http://keycloak:8080/realms/x'],
      ),
    ).not.toThrow()
  })

  it('rejects endpoints on a foreign origin', () => {
    expect(() =>
      assertDiscoveryEndpointOrigins(
        {
          authorization_endpoint: 'https://idp.example/auth',
          token_endpoint: 'https://evil.example/token',
          jwks_uri: 'https://idp.example/jwks',
        },
        ['https://idp.example/realms/x'],
      ),
    ).toThrow(/token_endpoint.*outside the issuer origin/)
  })
})
