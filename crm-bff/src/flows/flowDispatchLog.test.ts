import { describe, expect, it } from 'vitest'
import {
  flowDebugRequested,
  flowDispatchContext,
  truncateFlowRequestBody,
} from './flowDispatchLog.js'

describe('truncateFlowRequestBody', () => {
  it('stringifies compact payloads', () => {
    expect(truncateFlowRequestBody({ a: 1 })).toBe('{"a":1}')
  })

  it('truncates long payloads', () => {
    const big = { data: 'x'.repeat(9000) }
    const text = truncateFlowRequestBody(big, 100)
    expect(text?.endsWith('…')).toBe(true)
    expect((text?.length ?? 0) <= 101).toBe(true)
  })
})

describe('flowDebugRequested', () => {
  it('is true for boolean or string true', () => {
    expect(flowDebugRequested({ debug: true })).toBe(true)
    expect(flowDebugRequested({ debug: 'true' })).toBe(true)
    expect(flowDebugRequested({ debug: 'TRUE' })).toBe(true)
  })

  it('is false when missing or off', () => {
    expect(flowDebugRequested(null)).toBe(false)
    expect(flowDebugRequested({})).toBe(false)
    expect(flowDebugRequested({ debug: false })).toBe(false)
    expect(flowDebugRequested({ debug: 'no' })).toBe(false)
  })
})

describe('flowDispatchContext', () => {
  it('reads record automation fields', () => {
    expect(
      flowDispatchContext({
        source: 'record_automation',
        collection: 'opportunity',
        recordId: 'rec-1',
      }),
    ).toEqual({
      source: 'record_automation',
      collection: 'opportunity',
      recordId: 'rec-1',
    })
  })

  it('reads a nested webhook body', () => {
    expect(
      flowDispatchContext({
        body: { source: 'schedule', collection: 'account', recordId: 'a-2' },
      }),
    ).toEqual({
      source: 'schedule',
      collection: 'account',
      recordId: 'a-2',
    })
  })

  it('falls back when the payload is empty', () => {
    expect(flowDispatchContext(null)).toEqual({
      source: 'flow',
      collection: null,
      recordId: null,
    })
  })
})
