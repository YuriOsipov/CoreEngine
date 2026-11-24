import { query } from '../db/pool.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import { actorIdFromMe } from '../auth/rolePreview.js'

export type ConfigAuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'REPLACE'

export type ConfigResourceType =
  | 'entity'
  | 'field'
  | 'role'
  | 'role_permissions'
  | 'user'
  | 'layout'
  | 'org_setting'
  | 'automation'
  | 'unique_groups'
  | 'other'

export interface ConfigAuditRow {
  id: string
  action: ConfigAuditAction
  resourceType: ConfigResourceType
  resourceKey: string
  summary: string
  userId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  createdAt: string
}

const MAX_JSON_CHARS = 32_000

/** Drop undefined keys so audits store sparse patches, not form shells. */
export function compactAuditState(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue
    out[key] = entry
  }
  return Object.keys(out).length ? out : null
}

/**
 * Oversized payloads keep a 2_000-char JSON preview (not redacted).
 * Safe today: product org settings never store credentials (see
 * `orgSettingsService` inventory). Passwords stay out of audit payloads
 * (`passwordSet` / `passwordChanged` flags only). Do not put secrets into
 * audited before/after states.
 */
function clipJson(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const compact = compactAuditState(value)
  if (!compact) return null
  const raw = JSON.stringify(compact)
  if (raw.length <= MAX_JSON_CHARS) return compact
  return {
    _truncated: true,
    _originalChars: raw.length,
    preview: raw.slice(0, 2_000),
  }
}

/**
 * Append one Setup/config audit row. Best-effort: never throws to the caller
 * (registry mutation already succeeded). Returns the new id or null.
 */
export async function writeConfigAudit(options: {
  action: ConfigAuditAction
  resourceType: ConfigResourceType
  resourceKey: string
  summary: string
  userId?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}): Promise<string | null> {
  const resourceKey = String(options.resourceKey || '').trim()
  if (!resourceKey) return null
  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO public.config_audits (
         action, resource_type, resource_key, summary, user_id, before_state, after_state
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       RETURNING id::text AS id`,
      [
        options.action,
        options.resourceType,
        resourceKey,
        String(options.summary || '').slice(0, 500),
        options.userId ?? null,
        options.before != null
          ? JSON.stringify(clipJson(options.before))
          : null,
        options.after != null ? JSON.stringify(clipJson(options.after)) : null,
      ],
    )
    return rows[0]?.id ?? null
  } catch (error) {
    console.error('[configAudit] write failed', error)
    return null
  }
}

/** Stamp a config audit using the real session actor (not role-preview id). */
export async function recordConfigAudit(
  me: MeUser | null | undefined,
  options: {
    action: ConfigAuditAction
    resourceType: ConfigResourceType
    resourceKey: string
    summary: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  },
): Promise<void> {
  await writeConfigAudit({
    ...options,
    userId: actorIdFromMe(me),
  })
}

export async function listConfigAudits(options: {
  resourceType?: string | null
  resourceKey?: string | null
  limit?: number
  offset?: number
}): Promise<{ nodes: ConfigAuditRow[]; totalCount: number }> {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200)
  const offset = Math.max(Number(options.offset) || 0, 0)
  const filters: string[] = []
  const params: unknown[] = []

  if (options.resourceType?.trim()) {
    params.push(options.resourceType.trim())
    filters.push(`resource_type = $${params.length}`)
  }
  if (options.resourceKey?.trim()) {
    params.push(options.resourceKey.trim())
    filters.push(`resource_key = $${params.length}`)
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  const countRows = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM public.config_audits ${where}`,
    params,
  )
  params.push(limit, offset)
  const rows = await query<{
    id: string
    action: string
    resource_type: string
    resource_key: string
    summary: string
    user_id: string | null
    before_state: Record<string, unknown> | null
    after_state: Record<string, unknown> | null
    created_at: string
  }>(
    `SELECT id::text AS id,
            action,
            resource_type,
            resource_key,
            summary,
            user_id,
            before_state,
            after_state,
            created_at::text AS created_at
     FROM public.config_audits
     ${where}
     ORDER BY id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )

  return {
    totalCount: Number(countRows[0]?.count || 0),
    nodes: rows.map((row) => ({
      id: row.id,
      action: row.action as ConfigAuditAction,
      resourceType: row.resource_type as ConfigResourceType,
      resourceKey: row.resource_key,
      summary: row.summary,
      userId: row.user_id,
      before: row.before_state,
      after: row.after_state,
      createdAt: row.created_at,
    })),
  }
}
