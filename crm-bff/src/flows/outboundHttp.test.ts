import { describe, expect, it } from 'vitest'
import {
  allowLoopbackForUrl,
  assertOutboundUrlShape,
  isBlockedAddress,
  isHardBlockedAddress,
  isLoopbackAddress,
  isPrivateAddress,
} from './outboundHttp.js'

describe('address classification', () => {
  it.each([
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00:ec2::254',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
  ])('hard-blocks %s even when private is allowed', (address) => {
    expect(isHardBlockedAddress(address)).toBe(true)
    expect(isBlockedAddress(address, true)).toBe(true)
  })

  it('can waive loopback when allowLoopback is set', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isBlockedAddress('127.0.0.1', true, true)).toBe(false)
    expect(isBlockedAddress('169.254.169.254', true, true)).toBe(true)
  })

  it('allowLoopbackForUrl matches configured n8n host outside production', () => {
    const prevNode = process.env.NODE_ENV
    const prevBase = process.env.N8N_BASE_URL
    const prevFlag = process.env.FLOWS_ALLOW_LOOPBACK
    process.env.NODE_ENV = 'development'
    process.env.N8N_BASE_URL = 'http://localhost:5678'
    delete process.env.FLOWS_ALLOW_LOOPBACK
    try {
      expect(allowLoopbackForUrl(new URL('http://localhost:5678/webhook/x'))).toBe(true)
      expect(allowLoopbackForUrl(new URL('http://evil.local:5678/webhook/x'))).toBe(false)
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNode
      if (prevBase === undefined) delete process.env.N8N_BASE_URL
      else process.env.N8N_BASE_URL = prevBase
      if (prevFlag === undefined) delete process.env.FLOWS_ALLOW_LOOPBACK
      else process.env.FLOWS_ALLOW_LOOPBACK = prevFlag
    }
  })

  it.each(['10.1.2.3', '172.20.0.5', '192.168.1.1', 'fd00::1'])(
    'treats %s as private (blocked unless allowlisted)',
    (address) => {
      expect(isPrivateAddress(address)).toBe(true)
      expect(isBlockedAddress(address, false)).toBe(true)
      expect(isBlockedAddress(address, true)).toBe(false)
    },
  )

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows public %s', (address) => {
    expect(isBlockedAddress(address, false)).toBe(false)
  })
})

describe('assertOutboundUrlShape', () => {
  it('rejects non-http schemes and embedded credentials', () => {
    expect(() => assertOutboundUrlShape('file:///etc/passwd')).toThrow(/http or https/)
    expect(() => assertOutboundUrlShape('https://user:pw@example.com/')).toThrow(/credentials/)
  })

  it('normalizes decimal/hex loopback so hard-block applies', () => {
    expect(assertOutboundUrlShape('http://2130706433/').hostname).toBe('127.0.0.1')
    expect(assertOutboundUrlShape('http://0x7f000001/').hostname).toBe('127.0.0.1')
  })

  it('accepts plain https URLs', () => {
    expect(assertOutboundUrlShape('https://example.com/hook').host).toBe('example.com')
  })
})
