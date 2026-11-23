import { describe, expect, it } from 'vitest'
import {
  buildMessageForwardInitialValues,
  buildMessageReplyInitialValues,
  quoteMessageBody,
  withSubjectPrefix,
} from './messageCreateDefaults'

describe('quoteMessageBody', () => {
  it('prefixes each line with >', () => {
    expect(quoteMessageBody('hello\nworld')).toBe('> hello\n> world')
  })

  it('returns empty for blank body', () => {
    expect(quoteMessageBody('  \n  ')).toBe('')
  })
})

describe('buildMessageReplyInitialValues', () => {
  it('quotes body, prefers from_user as recipient, stamps From actor', () => {
    const values = buildMessageReplyInitialValues(
      {
        id: 'msg-1',
        subject: 'Hello',
        body: 'line one\nline two',
        type: 'internal',
        from_user: 'sender-1',
        owner_id: 'owner-1',
      },
      { fromUserId: 'rep-1', fromEmail: 'rep@example.com' },
    )
    expect(values.subject).toBe('Re: Hello')
    expect(values.body).toBe('> line one\n> line two')
    expect(values.to_user).toBe('sender-1')
    expect(values.from_user).toBe('rep-1')
    expect(values.from_email).toBe('rep@example.com')
    expect(values.is_draft).toBe(true)
    expect(values.source_message).toBeUndefined()
  })

  it('links source_message to the Incoming Message id, not the outbox', () => {
    const values = buildMessageReplyInitialValues({
      id: 'incoming-0005',
      status: 'new',
      source_message: 'outbox-0024',
      from_user: 'sender-1',
      body: 'x',
    })
    expect(values.source_message).toBe('incoming-0005')
  })

  it('falls back to owner when from_user missing', () => {
    const values = buildMessageReplyInitialValues({
      body: 'x',
      owner_id: 'owner-1',
    })
    expect(values.to_user).toBe('owner-1')
    expect(withSubjectPrefix('', 'Re:')).toBe('Re:')
  })
})

describe('buildMessageForwardInitialValues', () => {
  it('quotes body and clears to_user', () => {
    const values = buildMessageForwardInitialValues(
      { id: 'msg-2', subject: 'Hi', body: 'fwd me', from_user: 'a' },
      { fromUserId: 'rep-1' },
    )
    expect(values.subject).toBe('Fwd: Hi')
    expect(values.body).toBe('> fwd me')
    expect(values.to_user).toBeNull()
    expect(values.from_user).toBe('rep-1')
    expect(values.source_message).toBeUndefined()
  })

  it('links forward from Incoming Message to that inbox id', () => {
    const values = buildMessageForwardInitialValues(
      { id: 'incoming-0005', status: 'read', body: 'fwd me', from_user: 'a' },
      { fromUserId: 'rep-1' },
    )
    expect(values.source_message).toBe('incoming-0005')
  })
})
