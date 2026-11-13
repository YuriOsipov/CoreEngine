import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetOidcConfigCache } from './oidcConfig.js'
import { resetOidcDiscoveryCache } from './oidcDiscovery.js'
import { resetOidcJwksCache, verifyOidcIdToken } from './oidcIdToken.js'

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function signRs256(
  privateKeyPem: string,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  const data = `${h}.${p}`
  const signer = createSign('RSA-SHA256')
  signer.update(data)
  signer.end()
  const sig = signer.sign(privateKeyPem)
  return `${data}.${b64url(sig)}`
}

describe('verifyOidcIdToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetOidcConfigCache()
    resetOidcDiscoveryCache()
    resetOidcJwksCache()
  })

  it('accepts a JWKS-signed id_token with matching nonce', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    })
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const jwk = publicKey.export({ format: 'jwk' })
    const kid = randomUUID()
    const issuer = 'http://idp.test/realms/coreengine'
    const clientId = 'coreengine'
    const nonce = 'nonce-abc'

    process.env.OIDC_ENABLED = 'true'
    process.env.OIDC_ISSUER = issuer
    process.env.OIDC_CLIENT_ID = clientId
    process.env.OIDC_CLIENT_SECRET = 'secret'
    process.env.OIDC_REDIRECT_URI = 'http://localhost:4000/auth/oidc/callback'
    process.env.OIDC_UI_ORIGIN = 'http://localhost:5173'
    resetOidcConfigCache()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url)
        if (href.includes('.well-known/openid-configuration')) {
          return new Response(
            JSON.stringify({
              issuer,
              authorization_endpoint: `${issuer}/auth`,
              token_endpoint: `${issuer}/token`,
              jwks_uri: `${issuer}/jwks`,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        if (href.includes('/jwks')) {
          return new Response(
            JSON.stringify({
              keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        throw new Error(`unexpected fetch ${href}`)
      }),
    )

    const now = Math.floor(Date.now() / 1000)
    const token = signRs256(
      privatePem,
      { alg: 'RS256', typ: 'JWT', kid },
      {
        iss: issuer,
        sub: 'user-1',
        aud: clientId,
        email: 'admin@example.com',
        email_verified: true,
        nonce,
        iat: now,
        exp: now + 300,
      },
    )

    const claims = await verifyOidcIdToken(token, nonce)
    expect(claims).toMatchObject({
      sub: 'user-1',
      email: 'admin@example.com',
      iss: issuer,
    })
  })
})
