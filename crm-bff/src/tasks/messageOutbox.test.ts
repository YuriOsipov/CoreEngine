import { describe, expect, it } from 'vitest'
import {
  buildMessageOutboxSql,
  DEFAULT_MESSAGE_MAX_ATTEMPTS,
  DEFAULT_MESSAGE_STALE_MINUTES,
  readAttempts,
  resolveMessageOutboxPolicy,
} from './messageOutbox.js'

describe('resolveMessageOutboxPolicy', () => {
  const now = new Date('2026-01-01T00:15:00.000Z')

  it('defaults to 15 minutes and 5 attempts', () => {
    const policy = resolveMessageOutboxPolicy({}, now)
    expect(policy.staleMinutes).toBe(DEFAULT_MESSAGE_STALE_MINUTES)
    expect(policy.maxAttempts).toBe(DEFAULT_MESSAGE_MAX_ATTEMPTS)
    expect(policy.nowIso).toBe('2026-01-01T00:15:00.000Z')
    expect(policy.staleBeforeIso).toBe('2026-01-01T00:00:00.000Z')
  })

  it('clamps invalid knobs back to the defaults', () => {
    const policy = resolveMessageOutboxPolicy(
      { staleMinutes: 0, maxAttempts: -2 },
      now,
    )
    expect(policy.staleMinutes).toBe(DEFAULT_MESSAGE_STALE_MINUTES)
    expect(policy.maxAttempts).toBe(DEFAULT_MESSAGE_MAX_ATTEMPTS)
  })

  it('caps a stale window that is longer than a day', () => {
    const policy = resolveMessageOutboxPolicy({ staleMinutes: 5000, maxAttempts: 500 }, now)
    expect(policy.staleMinutes).toBe(24 * 60)
    expect(policy.maxAttempts).toBe(100)
  })

  it('accepts an override inside the allowed range', () => {
    const policy = resolveMessageOutboxPolicy(
      { staleMinutes: 30, maxAttempts: 3 },
      now,
    )
    expect(policy).toMatchObject({ staleMinutes: 30, maxAttempts: 3 })
    expect(policy.staleBeforeIso).toBe('2025-12-31T23:45:00.000Z')
  })
})

describe('readAttempts', () => {
  it('reads numeric and numeric-string counts', () => {
    expect(readAttempts(2)).toBe(2)
    expect(readAttempts('4')).toBe(4)
    expect(readAttempts(null)).toBe(0)
    expect(readAttempts('nope')).toBe(0)
  })
})

describe('buildMessageOutboxSql', () => {
  it('claims due queued rows and stale sending rows, and caps attempts', () => {
    const sql = buildMessageOutboxSql({
      storage: 'jsonb',
      relationSql: 'public.business_records',
      promoted: [],
      hasDeleted: false,
    })
    expect(sql.claimSql).toContain('FOR UPDATE SKIP LOCKED')
    expect(sql.claimSql).toContain("= 'queued'")
    expect(sql.claimSql).toContain("= 'sending'")
    expect(sql.claimSql).toContain("data->>'attempts'")
    expect(sql.claimSql).toContain("data->>'sending_since'")
    expect(sql.claimSql).toContain("'{delivery_status}'")
    expect(sql.claimSql).toContain("'{attempts}'")
    expect(sql.claimSql).toContain("'{sending_since}'")
    expect(sql.claimSql).not.toContain('"attempts"')
    expect(sql.claimSql).toContain('d.entity_api_name = $1')
    expect(sql.claimSql).toContain('m.entity_api_name = $1')
    expect(sql.claimSql).toContain('LIMIT $5')

    expect(sql.exhaustSql).toContain(`'failed'::text`)
    expect(sql.exhaustSql).toContain("= 'sending'")
    expect(sql.exhaustSql).toContain('>= $3::bigint')
    expect(sql.exhaustSql).not.toContain("= 'queued'")

    expect(sql.releaseSql).toContain("'queued'")
    expect(sql.releaseSql).toContain("'failed'")
    expect(sql.releaseSql).toContain("IN ('sending', 'failed')")
    expect(sql.releaseSql).not.toContain("'sent'")
    expect(sql.releaseSql).toContain('m.record_id = $2')
  })

  it('writes promoted columns as well as the jsonb mirror', () => {
    const sql = buildMessageOutboxSql({
      storage: 'typed',
      relationSql: '"crm_schema"."message"',
      promoted: ['delivery_status', 'sending_since', 'attempts', 'is_draft', 'scheduled_send_at'],
      hasDeleted: true,
    })
    expect(sql.claimSql).toContain('"attempts" =')
    expect(sql.claimSql).toContain('"sending_since" = $1::timestamptz')
    expect(sql.claimSql).toContain(`"delivery_status" = 'sending'`)
    expect(sql.claimSql).toContain('is_deleted')
    expect(sql.claimSql).toContain('LIMIT $4')
    expect(sql.claimSql).not.toContain('entity_api_name')
    expect(sql.exhaustSql).toContain('"delivery_status" =')
    expect(sql.releaseSql).toContain('m.record_id = $1')
  })
})
