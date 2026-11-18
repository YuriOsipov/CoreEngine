import { describe, expect, it } from 'vitest'
import { flowDispatchContext } from './flowDispatchLog.js'

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
