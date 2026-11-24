/**
 * Message outbox claim policy and SQL.
 * Pure module: no database import, so tests can load it without a pool.
 *
 * A claim sets delivery_status=sending, sending_since=now, attempts=attempts+1.
 * Rows still sending after staleMinutes are claimed again (process died).
 * Rows at maxAttempts are marked failed instead of claimed.
 * A caught failure returns the row to queued and keeps sending_since, so the
 * same window is the backoff — a persistent error does not retry every tick.
 */

export const DEFAULT_MESSAGE_STALE_MINUTES = 15
export const DEFAULT_MESSAGE_MAX_ATTEMPTS = 5

export type MessageOutboxPolicy = {
  nowIso: string
  staleMinutes: number
  maxAttempts: number
  staleBeforeIso: string
}

export type MessageOutboxSqlInput = {
  storage: 'typed' | 'jsonb'
  relationSql: string
  promoted: ReadonlySet<string> | readonly string[]
  hasDeleted: boolean
}

export type MessageOutboxSql = {
  claimSql: string
  exhaustSql: string
  releaseSql: string
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < min) return fallback
  return Math.min(max, Math.floor(n))
}

export function resolveMessageOutboxPolicy(
  params: Record<string, unknown>,
  now = new Date(),
): MessageOutboxPolicy {
  const staleMinutes = clampInt(
    params.staleMinutes,
    DEFAULT_MESSAGE_STALE_MINUTES,
    1,
    24 * 60,
  )
  const maxAttempts = clampInt(params.maxAttempts, DEFAULT_MESSAGE_MAX_ATTEMPTS, 1, 100)
  const nowIso = now.toISOString()
  const staleBeforeIso = new Date(now.getTime() - staleMinutes * 60_000).toISOString()
  return { nowIso, staleMinutes, maxAttempts, staleBeforeIso }
}

export function readAttempts(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function asPromoted(promoted: ReadonlySet<string> | readonly string[]): Set<string> {
  return promoted instanceof Set ? promoted : new Set(promoted)
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`
}

function statusExpr(alias: string, promoted: Set<string>): string {
  if (promoted.has('delivery_status')) {
    return `COALESCE(${alias}.${quoteIdent('delivery_status')}, '')`
  }
  return `COALESCE(${alias}.data->>'delivery_status', '')`
}

function attemptsExpr(alias: string, promoted: Set<string>): string {
  const fromJson = `NULLIF(${alias}.data->>'attempts', '')::bigint`
  if (promoted.has('attempts')) {
    return `COALESCE(${alias}.${quoteIdent('attempts')}, ${fromJson}, 0)`
  }
  return `COALESCE(${fromJson}, 0)`
}

function sendingSinceExpr(alias: string, promoted: Set<string>): string {
  const fromJson = `NULLIF(${alias}.data->>'sending_since', '')::timestamptz`
  if (promoted.has('sending_since')) {
    return `COALESCE(${alias}.${quoteIdent('sending_since')}, ${fromJson})`
  }
  return fromJson
}

function draftOkExpr(alias: string, promoted: Set<string>): string {
  const raw = promoted.has('is_draft')
    ? `COALESCE((${alias}.${quoteIdent('is_draft')})::text, 'false')`
    : `COALESCE(${alias}.data->>'is_draft', 'false')`
  return `${raw} NOT IN ('true', '1', 't')`
}

function scheduledExpr(alias: string, promoted: Set<string>): string {
  if (promoted.has('scheduled_send_at')) {
    return `${alias}.${quoteIdent('scheduled_send_at')}`
  }
  return `NULLIF(${alias}.data->>'scheduled_send_at', '')`
}

function deletedSql(hasDeleted: boolean): string {
  return hasDeleted ? `AND COALESCE(is_deleted, false) = false` : ''
}

/** Mirror outbox keys into data jsonb and into promoted columns when present. */
function assignStatus(alias: string, promoted: Set<string>, statusSql: string): string {
  const parts = [
    `data = jsonb_set(COALESCE(${alias}.data, '{}'::jsonb), '{delivery_status}', to_jsonb(${statusSql}), true)`,
  ]
  if (promoted.has('delivery_status')) {
    parts.push(`${quoteIdent('delivery_status')} = ${statusSql}`)
  }
  parts.push('updated_at = now()')
  return parts.join(',\n         ')
}

function assignClaim(alias: string, promoted: Set<string>, nowParam: string): string {
  const nextAttempts = `(${attemptsExpr(alias, promoted)} + 1)`
  const dataExpr = `jsonb_set(
           jsonb_set(
             jsonb_set(COALESCE(${alias}.data, '{}'::jsonb), '{delivery_status}', '"sending"'::jsonb, true),
             '{sending_since}', to_jsonb(${nowParam}::text), true
           ),
           '{attempts}', to_jsonb(${nextAttempts}), true
         )`
  const parts = [`data = ${dataExpr}`]
  if (promoted.has('delivery_status')) {
    parts.push(`${quoteIdent('delivery_status')} = 'sending'`)
  }
  if (promoted.has('sending_since')) {
    parts.push(`${quoteIdent('sending_since')} = ${nowParam}::timestamptz`)
  }
  if (promoted.has('attempts')) {
    parts.push(`${quoteIdent('attempts')} = ${nextAttempts}`)
  }
  parts.push('updated_at = now()')
  return parts.join(',\n         ')
}

function dueOrStale(
  alias: string,
  promoted: Set<string>,
  nowParam: string,
  staleParam: string,
  maxParam: string,
): string {
  const status = statusExpr(alias, promoted)
  const attempts = attemptsExpr(alias, promoted)
  const since = sendingSinceExpr(alias, promoted)
  const scheduled = scheduledExpr(alias, promoted)
  const backoffElapsed = `(${since} IS NULL OR ${since} <= ${staleParam}::timestamptz)`
  return `${draftOkExpr(alias, promoted)}
           AND (
             (
               ${status} = 'queued'
               AND ${scheduled} IS NOT NULL
               AND (${scheduled})::timestamptz <= ${nowParam}::timestamptz
               AND ${attempts} < ${maxParam}::bigint
               AND ${backoffElapsed}
             )
             OR (
               ${status} = 'sending'
               AND ${backoffElapsed}
               AND ${attempts} < ${maxParam}::bigint
             )
           )`
}

/**
 * Claim params (typed): $1 now, $2 staleBefore, $3 maxAttempts, $4 limit.
 * Claim params (jsonb): $1 collection, $2 now, $3 staleBefore, $4 maxAttempts, $5 limit.
 * Exhaust params (typed): $1 staleBefore, $2 maxAttempts.
 * Exhaust params (jsonb): $1 collection, $2 staleBefore, $3 maxAttempts.
 * Release params (typed): $1 id, $2 maxAttempts.
 * Release params (jsonb): $1 collection, $2 id, $3 maxAttempts.
 */
export function buildMessageOutboxSql(input: MessageOutboxSqlInput): MessageOutboxSql {
  const promoted = asPromoted(input.promoted)
  const relation = input.relationSql
  const deleted = deletedSql(input.hasDeleted)
  const jsonb = input.storage === 'jsonb'
  const claimNow = jsonb ? '$2' : '$1'
  const claimStale = jsonb ? '$3' : '$2'
  const claimMax = jsonb ? '$4' : '$3'
  const claimLimit = jsonb ? '$5' : '$4'
  const exhaustStale = jsonb ? '$2' : '$1'
  const exhaustMax = jsonb ? '$3' : '$2'
  const releaseId = jsonb ? '$2' : '$1'
  const releaseMax = jsonb ? '$3' : '$2'
  const entityFilter = jsonb ? `d.entity_api_name = $1 AND ` : ''
  const claimEntity = jsonb ? `m.entity_api_name = $1 AND ` : ''
  const exhaustEntity = jsonb ? `m.entity_api_name = $1 AND ` : ''
  const releaseEntity = jsonb ? `m.entity_api_name = $1 AND ` : ''

  const since = sendingSinceExpr('d', promoted)
  const scheduled = scheduledExpr('d', promoted)
  const releaseStatus = `CASE WHEN ${attemptsExpr('m', promoted)} >= ${releaseMax}::bigint THEN 'failed' ELSE 'queued' END`

  const claimSql = `WITH due AS (
       SELECT d.record_id
       FROM ${relation} AS d
       WHERE ${entityFilter}${dueOrStale('d', promoted, claimNow, claimStale, claimMax)}
         ${deleted}
       ORDER BY COALESCE(${since}, (${scheduled})::timestamptz) ASC NULLS LAST
       FOR UPDATE SKIP LOCKED
       LIMIT ${claimLimit}
     )
     UPDATE ${relation} AS m
     SET ${assignClaim('m', promoted, claimNow)}
     FROM due
     WHERE ${claimEntity}m.record_id = due.record_id
       AND ${statusExpr('m', promoted)} IN ('queued', 'sending')
     RETURNING m.*`

  const exhaustSql = `UPDATE ${relation} AS m
     SET ${assignStatus('m', promoted, `'failed'::text`)}
     WHERE ${exhaustEntity}${draftOkExpr('m', promoted)}
       AND ${statusExpr('m', promoted)} = 'sending'
       AND ${attemptsExpr('m', promoted)} >= ${exhaustMax}::bigint
       AND (
         ${sendingSinceExpr('m', promoted)} IS NULL
         OR ${sendingSinceExpr('m', promoted)} <= ${exhaustStale}::timestamptz
       )
       ${deleted}
     RETURNING m.record_id`

  const releaseSql = `UPDATE ${relation} AS m
     SET ${assignStatus('m', promoted, releaseStatus)}
     WHERE ${releaseEntity}m.record_id = ${releaseId}
       AND ${statusExpr('m', promoted)} IN ('sending', 'failed')
       AND NOT (
         ${statusExpr('m', promoted)} = 'failed'
         AND ${attemptsExpr('m', promoted)} >= ${releaseMax}::bigint
       )
     RETURNING m.*`

  return { claimSql, exhaustSql, releaseSql }
}
