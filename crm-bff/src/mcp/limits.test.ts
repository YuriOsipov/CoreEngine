import { afterEach, describe, expect, it } from 'vitest'
import {
  mcpQueryMaxLimit,
  mcpRateLimitPerMinute,
  mcpSchemaWriteEnabled,
} from './limits.js'

const KEYS = [
  'MCP_SCHEMA_WRITE_ENABLED',
  'MCP_RATE_LIMIT_PER_MIN',
  'MCP_QUERY_MAX_LIMIT',
] as const

const saved: Record<string, string | undefined> = {}

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
    delete saved[key]
  }
})

function stash(key: (typeof KEYS)[number]): void {
  if (!(key in saved)) saved[key] = process.env[key]
}

describe('mcp limits', () => {
  it('defaults schema write off', () => {
    stash('MCP_SCHEMA_WRITE_ENABLED')
    delete process.env.MCP_SCHEMA_WRITE_ENABLED
    expect(mcpSchemaWriteEnabled()).toBe(false)
  })

  it('enables schema write when flagged', () => {
    stash('MCP_SCHEMA_WRITE_ENABLED')
    process.env.MCP_SCHEMA_WRITE_ENABLED = 'true'
    expect(mcpSchemaWriteEnabled()).toBe(true)
  })

  it('caps rate and query limits', () => {
    stash('MCP_RATE_LIMIT_PER_MIN')
    stash('MCP_QUERY_MAX_LIMIT')
    process.env.MCP_RATE_LIMIT_PER_MIN = '999999'
    process.env.MCP_QUERY_MAX_LIMIT = '0'
    expect(mcpRateLimitPerMinute()).toBe(10_000)
    expect(mcpQueryMaxLimit()).toBe(1)
  })
})
