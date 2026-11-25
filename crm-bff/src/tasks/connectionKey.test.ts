import { describe, expect, it } from 'vitest'
import { resolveConnectionKey } from './connectionKey.js'

describe('resolveConnectionKey', () => {
  it('prefers connectionKey, then connection, then flowKey, then webhook', () => {
    expect(
      resolveConnectionKey({
        connectionKey: 'a',
        connection: 'b',
        flowKey: 'c',
        webhook: 'd',
      }),
    ).toBe('a')
    expect(resolveConnectionKey({ connection: 'b', flowKey: 'c' })).toBe('b')
    expect(resolveConnectionKey({ flowKey: 'c', webhook: 'd' })).toBe('c')
    expect(resolveConnectionKey({ webhook: 'd' })).toBe('d')
    expect(resolveConnectionKey({}, 'fallback')).toBe('fallback')
  })
})
