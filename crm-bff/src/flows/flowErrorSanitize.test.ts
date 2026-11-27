import { describe, expect, it } from 'vitest'
import { sanitizeFlowErrorMessage } from './flowErrorSanitize.js'

describe('sanitizeFlowErrorMessage', () => {
  it('redacts absolute URLs', () => {
    expect(
      sanitizeFlowErrorMessage(
        'Flow "hook" request refused/failed: getaddrinfo ENOTFOUND https://hooks.example/secret-path?x=1',
      ),
    ).toContain('[url]')
    expect(
      sanitizeFlowErrorMessage('failed https://hooks.example/a?token=abc123 more'),
    ).not.toMatch(/hooks\.example/)
  })

  it('redacts bearer and basic credentials', () => {
    expect(sanitizeFlowErrorMessage('Authorization Bearer abc.def.ghi')).toBe(
      'Authorization Bearer [redacted]',
    )
    expect(sanitizeFlowErrorMessage('got Basic dXNlcjpwYXNz')).toBe(
      'got Basic [redacted]',
    )
  })

  it('redacts query and header-style secrets', () => {
    expect(
      sanitizeFlowErrorMessage('upstream ?api_key=abc&other=1'),
    ).toContain('api_key=[redacted]')
    expect(
      sanitizeFlowErrorMessage('x-api-key: deadbeef'),
    ).toContain('[redacted]')
  })
})
