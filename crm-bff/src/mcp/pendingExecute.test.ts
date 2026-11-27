import { describe, expect, it } from 'vitest'
import { summarizePendingPayload } from './pendingExecute.js'

describe('summarizePendingPayload', () => {
  it('summarizes retry_message', () => {
    expect(
      summarizePendingPayload('retry_message', {
        recordId: 'msg-1',
        collection: 'message',
        connectionKey: 'dispatch_outbound_message',
      }),
    ).toBe('Retry message/msg-1 via dispatch_outbound_message')
  })

  it('summarizes upsert_object_schema', () => {
    expect(
      summarizePendingPayload('upsert_object_schema', {
        apiName: 'account',
        fields: [{ apiName: 'name' }, { apiName: 'phone' }],
      }),
    ).toBe('Upsert schema account (2 fields)')
  })

  it('summarizes update_role_layout', () => {
    expect(
      summarizePendingPayload('update_role_layout', {
        entityApiName: 'account',
        groupKey: 'record',
      }),
    ).toBe('Update layout account/record')
  })
})
