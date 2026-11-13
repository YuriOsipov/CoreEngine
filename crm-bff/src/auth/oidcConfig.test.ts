import { afterEach, describe, expect, it } from 'vitest'
import {
  assertOidcConfigReady,
  oidcDiscoveryUrl,
  readOidcConfig,
  resetOidcConfigCache,
} from './oidcConfig.js'

const OIDC_KEYS = [
  'OIDC_ENABLED',
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI',
  'OIDC_UI_ORIGIN',
  'OIDC_SCOPES',
  'OIDC_DISPLAY_NAME',
  'OIDC_JIT_PROVISION',
  'OIDC_DEFAULT_ROLE_BACKEND_ID',
  'OIDC_AUDIENCE',
  'CORS_ORIGIN',
] as const

function clearOidcEnv(): void {
  for (const key of OIDC_KEYS) delete process.env[key]
  resetOidcConfigCache()
}

describe('oidcConfig', () => {
  afterEach(() => {
    clearOidcEnv()
  })

  it('reports disabled by default', () => {
    clearOidcEnv()
    const cfg = readOidcConfig()
    expect(cfg.enabled).toBe(false)
    expect(() => assertOidcConfigReady()).not.toThrow()
  })

  it('requires core fields when enabled', () => {
    clearOidcEnv()
    process.env.OIDC_ENABLED = 'true'
    process.env.OIDC_ISSUER = 'http://localhost:8081/realms/coreengine'
    expect(() => assertOidcConfigReady()).toThrow(/OIDC_CLIENT_ID/)
  })

  it('requires default role when JIT is on', () => {
    clearOidcEnv()
    process.env.OIDC_ENABLED = 'true'
    process.env.OIDC_ISSUER = 'http://localhost:8081/realms/coreengine'
    process.env.OIDC_CLIENT_ID = 'coreengine'
    process.env.OIDC_CLIENT_SECRET = 'secret'
    process.env.OIDC_REDIRECT_URI = 'http://localhost:4000/auth/oidc/callback'
    process.env.OIDC_UI_ORIGIN = 'http://localhost:5173'
    process.env.OIDC_JIT_PROVISION = 'true'
    expect(() => assertOidcConfigReady()).toThrow(/OIDC_DEFAULT_ROLE_BACKEND_ID/)
  })

  it('passes when fully configured', () => {
    clearOidcEnv()
    process.env.OIDC_ENABLED = 'true'
    process.env.OIDC_ISSUER = 'http://localhost:8081/realms/coreengine/'
    process.env.OIDC_CLIENT_ID = 'coreengine'
    process.env.OIDC_CLIENT_SECRET = 'secret'
    process.env.OIDC_REDIRECT_URI = 'http://localhost:4000/auth/oidc/callback'
    process.env.OIDC_UI_ORIGIN = 'http://localhost:5173'
    process.env.OIDC_DISPLAY_NAME = 'Keycloak'
    const cfg = readOidcConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.issuer).toBe('http://localhost:8081/realms/coreengine')
    expect(cfg.displayName).toBe('Keycloak')
    expect(() => assertOidcConfigReady()).not.toThrow()
    expect(oidcDiscoveryUrl(cfg.issuer)).toBe(
      'http://localhost:8081/realms/coreengine/.well-known/openid-configuration',
    )
  })
})
