import { describe, expect, it } from 'vitest'
import {
  hashMcpToken,
  isMcpCredentialToken,
  MCP_TOKEN_PREFIX,
  normalizeMcpScopes,
} from './credentials.js'

describe('MCP credentials helpers', () => {
  it('detects ce_mcp_ prefix', () => {
    expect(isMcpCredentialToken(`${MCP_TOKEN_PREFIX}abc`)).toBe(true)
    expect(isMcpCredentialToken('eyJhbGciOi')).toBe(false)
  })

  it('hashes stably', () => {
    const a = hashMcpToken(`${MCP_TOKEN_PREFIX}one`)
    const b = hashMcpToken(`${MCP_TOKEN_PREFIX}one`)
    const c = hashMcpToken(`${MCP_TOKEN_PREFIX}two`)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('normalizes scopes with read default', () => {
    expect(normalizeMcpScopes(undefined)).toEqual(['read'])
    expect(normalizeMcpScopes([])).toEqual(['read'])
    expect(normalizeMcpScopes(['WRITE', 'read', 'write', 'nope'])).toEqual([
      'write',
      'read',
    ])
    expect(normalizeMcpScopes(['schema'])).toEqual(['schema'])
  })
})
