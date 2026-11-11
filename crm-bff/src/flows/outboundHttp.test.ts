import { describe, expect, it } from 'vitest'
import {
  assertOutboundUrlShape,
  isBlockedAddress,
  isHardBlockedAddress,
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
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
  ])('hard-blocks %s even when private is allowed', (address) => {
    expect(isHardBlockedAddress(address)).toBe(true)
    expect(isBlockedAddress(address, true)).toBe(true)
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
