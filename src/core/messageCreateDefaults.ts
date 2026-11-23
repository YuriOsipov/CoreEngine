/**
 * Related create from Users → Messages (`to_user`) should prefill the recipient
 * but keep the picker editable so the sender can choose another internal user.
 *
 * Reply / Forward on Message detail create a new owned draft from an inbound row.
 */

import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'
import { readUsersBridge } from '@/core/graphql/usersApi'

export type MessageComposeMode = 'reply' | 'forward'

export type MessageComposeActor = {
  /** Effective sender (`me.id` / preview sample user). */
  fromUserId?: string | null
  /** Sender email when known for this actor. */
  fromEmail?: string | null
}

/** Resolve From email for the effective compose actor (incl. View-as-role sample). */
export async function resolveMessageComposeFromEmail(
  fromUserId: string | null | undefined,
): Promise<string | null> {
  const id = String(fromUserId ?? '').trim()
  if (!id) return null
  try {
    const rows = await readUsersBridge({
      ids: [id],
      fields: ['id', 'email'],
      limit: 1,
    })
    const email = rows[0]?.email
    return typeof email === 'string' && email.trim() ? email.trim() : null
  } catch {
    return null
  }
}

export function messageRelatedCreateParentField(
  collection: string,
  parentField: string | null | undefined,
): string | undefined {
  const field = String(parentField ?? '').trim()
  if (!field) return undefined
  if (collection === 'message' && field === 'to_user') return undefined
  return field
}

export function messageRelatedCreateInitialValues(
  collection: string,
  parentField: string | null | undefined,
  parentId: string | number | null | undefined,
): Record<string, unknown> | undefined {
  if (collection !== 'message') return undefined
  if (String(parentField ?? '').trim() !== 'to_user') return undefined
  if (parentId === undefined || parentId === null || parentId === '') return undefined
  return {
    type: 'internal',
    to_user: parentId,
  }
}

function copyScalarOrFk(
  source: Record<string, unknown>,
  field: string,
): unknown | undefined {
  const raw = source[field]
  if (raw === undefined || raw === null || raw === '') return undefined
  const fk = extractRelationFieldId(raw)
  if (fk !== null) return fk
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return raw
  }
  return undefined
}

function copySharedMessageFields(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    is_draft: true,
  }
  const type = copyScalarOrFk(source, 'type')
  out.type = typeof type === 'string' && type.trim() ? type.trim() : 'internal'

  for (const field of ['contact', 'opportunity', 'email', 'phone'] as const) {
    const value = copyScalarOrFk(source, field)
    if (value !== undefined) out[field] = value
  }
  return out
}

function applyComposeActor(
  values: Record<string, unknown>,
  actor?: MessageComposeActor,
): Record<string, unknown> {
  const fromUser = String(actor?.fromUserId ?? '').trim()
  if (fromUser) values.from_user = fromUser
  const fromEmail = String(actor?.fromEmail ?? '').trim()
  if (fromEmail) values.from_email = fromEmail
  return values
}

function sourceSubject(source: Record<string, unknown>): string {
  const raw = source.subject
  return typeof raw === 'string' ? raw.trim() : ''
}

function sourceBody(source: Record<string, unknown>): string {
  const raw = source.body
  return typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
}

/** Idempotent subject prefix (Re: Re: x → Re: x). */
export function withSubjectPrefix(subject: string, prefix: 'Re:' | 'Fwd:'): string {
  const trimmed = subject.trim()
  const re = new RegExp(`^${prefix}\\s*`, 'i')
  const bare = trimmed.replace(re, '').trim()
  if (!bare) return prefix
  return `${prefix} ${bare}`
}

/** Email-style quote: each line prefixed with `> `. */
export function quoteMessageBody(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n').replace(/\s+$/u, '')
  if (!normalized.trim()) return ''
  return normalized
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function quotedBody(source: Record<string, unknown>): string {
  return quoteMessageBody(sourceBody(source))
}

/** Prefer explicit From user, then owner / Created By (legacy rows). */
function replyRecipientId(source: Record<string, unknown>): string | number | null {
  return (
    extractRelationFieldId(source.from_user) ??
    extractRelationFieldId(source.owner_id) ??
    extractRelationFieldId(source.user_created)
  )
}

/** Link reply/forward to the current Incoming Message id (inbox has `status`). */
function sourceMessageLinkId(source: Record<string, unknown>): string | number | null {
  if (!('status' in source)) return null
  return extractRelationFieldId(source.id)
}

export function buildMessageReplyInitialValues(
  source: Record<string, unknown>,
  actor?: MessageComposeActor,
): Record<string, unknown> {
  const values = applyComposeActor(copySharedMessageFields(source), actor)
  values.subject = withSubjectPrefix(sourceSubject(source), 'Re:')
  values.body = quotedBody(source)

  const replyTo = replyRecipientId(source)
  if (replyTo !== null) values.to_user = replyTo

  const sourceMessage = sourceMessageLinkId(source)
  if (sourceMessage !== null) values.source_message = sourceMessage

  return values
}

export function buildMessageForwardInitialValues(
  source: Record<string, unknown>,
  actor?: MessageComposeActor,
): Record<string, unknown> {
  const values = applyComposeActor(copySharedMessageFields(source), actor)
  values.subject = withSubjectPrefix(sourceSubject(source), 'Fwd:')
  values.body = quotedBody(source)
  // Clear any layout/default recipient — forward must pick a new To user.
  values.to_user = null

  const sourceMessage = sourceMessageLinkId(source)
  if (sourceMessage !== null) values.source_message = sourceMessage

  return values
}

export function buildMessageComposeInitialValues(
  mode: MessageComposeMode,
  source: Record<string, unknown>,
  actor?: MessageComposeActor,
): Record<string, unknown> {
  return mode === 'reply'
    ? buildMessageReplyInitialValues(source, actor)
    : buildMessageForwardInitialValues(source, actor)
}

/** True when the current user is the Message `to_user` (inbound / read-share). */
export function isMessageRecipient(
  collection: string,
  record: Record<string, unknown>,
  currentUserId: string | null | undefined,
): boolean {
  if (collection !== 'message') return false
  const me = String(currentUserId ?? '').trim()
  if (!me) return false
  const toUser = extractRelationFieldId(record.to_user)
  return toUser !== null && String(toUser) === me
}
