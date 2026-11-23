import { describe, expect, it } from 'vitest'
import {
  buildCreateRecordInitialValues,
  canShowCreateRecordAction,
  isCreateRecordActionVisible,
} from './createRecordAction'
import type { EntityActionCreateRecordSettings } from '@/interfaces'

const replySettings: EntityActionCreateRecordSettings = {
  targetCollection: 'message',
  openAfterCreate: true,
  whenSourceNotWritable: true,
  fieldMappings: [
    { targetField: 'is_draft', source: 'static', value: true },
    { targetField: 'type', source: 'static', value: 'internal' },
    { targetField: 'type', source: 'field', sourceField: 'type' },
    { targetField: 'contact', source: 'field', sourceField: 'contact' },
    {
      targetField: 'subject',
      source: 'field',
      sourceField: 'subject',
      transform: 'subjectPrefix',
      prefix: 'Re:',
    },
    {
      targetField: 'body',
      source: 'field',
      sourceField: 'body',
      transform: 'quoteLines',
    },
    {
      targetField: 'to_user',
      source: 'field',
      sourceFields: ['from_user', 'owner_id', 'user_created'],
    },
    { targetField: 'from_user', source: 'static', value: '$ME' },
    { targetField: 'from_email', source: 'static', value: '$ME_EMAIL' },
  ],
}

/** Reply from Incoming Message: map inbox id → Message.source_message */
const incomingReplySettings: EntityActionCreateRecordSettings = {
  targetCollection: 'message',
  fieldMappings: [
    { targetField: 'is_draft', source: 'static', value: true },
    { targetField: 'type', source: 'static', value: 'internal' },
    {
      targetField: 'subject',
      source: 'field',
      sourceField: 'subject',
      transform: 'subjectPrefix',
      prefix: 'Re:',
    },
    { targetField: 'source_message', source: 'field', sourceField: 'id' },
  ],
}

const forwardSettings: EntityActionCreateRecordSettings = {
  targetCollection: 'message',
  whenSourceNotWritable: true,
  fieldMappings: [
    { targetField: 'is_draft', source: 'static', value: true },
    { targetField: 'type', source: 'static', value: 'internal' },
    {
      targetField: 'subject',
      source: 'field',
      sourceField: 'subject',
      transform: 'subjectPrefix',
      prefix: 'Fwd:',
    },
    {
      targetField: 'body',
      source: 'field',
      sourceField: 'body',
      transform: 'quoteLines',
    },
    { targetField: 'to_user', source: 'static', value: '$NULL' },
    { targetField: 'from_user', source: 'static', value: '$ME' },
  ],
}

describe('canShowCreateRecordAction', () => {
  it('requires create on target and target collection', () => {
    expect(
      canShowCreateRecordAction({
        settings: { targetCollection: 'message' },
        canCreateTarget: false,
        sourceWritable: false,
      }),
    ).toBe(false)
    expect(
      canShowCreateRecordAction({
        settings: { targetCollection: '' },
        canCreateTarget: true,
        sourceWritable: false,
      }),
    ).toBe(false)
  })

  it('hides when whenSourceNotWritable and source is writable', () => {
    expect(
      canShowCreateRecordAction({
        settings: {
          targetCollection: 'message',
          whenSourceNotWritable: true,
        },
        canCreateTarget: true,
        sourceWritable: true,
      }),
    ).toBe(false)
    expect(
      canShowCreateRecordAction({
        settings: {
          targetCollection: 'message',
          whenSourceNotWritable: true,
        },
        canCreateTarget: true,
        sourceWritable: false,
      }),
    ).toBe(true)
  })
})

describe('isCreateRecordActionVisible', () => {
  it('is false for non-createRecord behaviors', () => {
    expect(
      isCreateRecordActionVisible(
        { behavior: 'flow' },
        { canCreateTarget: () => true, sourceWritable: false },
      ),
    ).toBe(false)
  })
})

describe('buildCreateRecordInitialValues', () => {
  it('builds Reply-equivalent values from message seed mappings', () => {
    const values = buildCreateRecordInitialValues(
      replySettings,
      {
        id: 'msg-1',
        type: 'email',
        subject: 'Hello',
        body: 'line1\nline2',
        from_user: { id: 'sender-1' },
        contact: 'contact-1',
        owner_id: 'owner-ignored',
      },
      { userId: 'me-1', email: 'me@example.com' },
    )
    expect(values).toEqual({
      is_draft: true,
      type: 'email',
      contact: 'contact-1',
      subject: 'Re: Hello',
      body: '> line1\n> line2',
      to_user: 'sender-1',
      from_user: 'me-1',
      from_email: 'me@example.com',
    })
  })

  it('maps Incoming Message id into Message.source_message on Reply', () => {
    const values = buildCreateRecordInitialValues(
      incomingReplySettings,
      {
        id: 'incoming-0005',
        status: 'new',
        subject: '0024',
        source_message: 'outbox-0024',
      },
    )
    expect(values.source_message).toBe('incoming-0005')
    expect(values.subject).toBe('Re: 0024')
  })

  it('falls back to owner_id for Reply to_user', () => {
    const values = buildCreateRecordInitialValues(
      replySettings,
      {
        subject: 'Hi',
        body: '',
        owner_id: 'owner-1',
        user_created: 'creator-1',
      },
      { userId: 'me-1' },
    )
    expect(values.to_user).toBe('owner-1')
    expect(values.subject).toBe('Re: Hi')
    expect(values.type).toBe('internal')
  })

  it('builds Forward-equivalent values and clears to_user', () => {
    const values = buildCreateRecordInitialValues(
      forwardSettings,
      {
        id: 'msg-fwd',
        subject: 'Fwd: Already',
        body: 'x',
        from_user: 'someone',
      },
      { userId: 'me-1' },
    )
    expect(values.subject).toBe('Fwd: Already')
    expect(values.to_user).toBeNull()
    expect(values.from_user).toBe('me-1')
    expect(values.body).toBe('> x')
    expect(values.source_message).toBeUndefined()
  })

  it('applies subjectPrefix when subject is missing', () => {
    const values = buildCreateRecordInitialValues(
      {
        targetCollection: 'message',
        fieldMappings: [
          {
            targetField: 'subject',
            source: 'field',
            sourceField: 'subject',
            transform: 'subjectPrefix',
            prefix: 'Re:',
          },
        ],
      },
      {},
    )
    expect(values.subject).toBe('Re:')
  })

  it('resolves $NOW as ISO string', () => {
    const values = buildCreateRecordInitialValues(
      {
        targetCollection: 'task',
        fieldMappings: [
          { targetField: 'due_at', source: 'static', value: '$NOW' },
        ],
      },
      {},
    )
    expect(typeof values.due_at).toBe('string')
    expect(String(values.due_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
