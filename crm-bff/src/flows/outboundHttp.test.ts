import { describe, expect, it } from 'vitest'
import { assertOutboundUrlShape, isBlockedAddress } from './outboundHttp.js'

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false)
  })
})

describe('assertOutboundUrlShape', () => {
  it('rejects non-http schemes and embedded credentials', () => {
    expect(() => assertOutboundUrlShape('file:///etc/passwd')).toThrow(/http or https/)
    expect(() => assertOutboundUrlShape('https://user:pw@example.com/')).toThrow(/credentials/)
  })

  it('accepts plain https URLs', () => {
    expect(assertOutboundUrlShape('https://example.com/hook').host).toBe('example.com')
  })
})
