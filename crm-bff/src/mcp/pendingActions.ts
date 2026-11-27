/**
 * Server-side human approval queue for destructive MCP tools.
 * A model-set `confirm: true` is never treated as approval.
 */
import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import { postgresFetchMe } from '../adapters/postgresUsers.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import { resolveAppUserPk } from './credentials.js'

export const MCP_PENDING_TOOLS = [
  'retry_message',
  'upsert_object_schema',
  'update_role_layout',
] as const

export type McpPendingToolName = (typeof MCP_PENDING_TOOLS)[number]

export type McpPendingStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'expired'

export type McpPendingActionRow = {
  id: string
  toolName: McpPendingToolName
  summary: string
  payload: Record<string, unknown>
  status: McpPendingStatus
  requestedByUserId: string
  mcpCredentialId: string | null
  requestedAt: string
  expiresAt: string
  decidedAt: string | null
  decidedByUserId: string | null
  decisionNote: string | null
  result: Record<string, unknown> | null
}

const DEFAULT_TTL_HOURS = 24

function isMissingTable(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    if ((error as { code?: string }).code === '42P01') return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /app_mcp_pending_actions/i.test(message) && /does not exist/i.test(message)
}

function mapRow(row: Record<string, unknown>): McpPendingActionRow {
  const payload =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {}
  const result =
    row.result && typeof row.result === 'object' && !Array.isArray(row.result)
      ? (row.result as Record<string, unknown>)
      : null
  return {
    id: String(row.id),
    toolName: String(row.tool_name) as McpPendingToolName,
    summary: String(row.summary),
    payload,
    status: String(row.status) as McpPendingStatus,
    requestedByUserId: String(row.requested_by_user_id),
    mcpCredentialId: row.mcp_credential_id
      ? String(row.mcp_credential_id)
      : null,
    requestedAt: new Date(String(row.requested_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    decidedAt: row.decided_at
      ? new Date(String(row.decided_at)).toISOString()
      : null,
    decidedByUserId: row.decided_by_user_id
      ? String(row.decided_by_user_id)
      : null,
    decisionNote: row.decision_note ? String(row.decision_note) : null,
    result,
  }
}

export function isMcpPendingTool(name: string): name is McpPendingToolName {
  return (MCP_PENDING_TOOLS as readonly string[]).includes(name)
}

/** Expire overdue pending rows (best-effort). */
export async function expireStalePendingActions(): Promise<void> {
  try {
    await query(
      `UPDATE public.app_mcp_pending_actions
       SET status = 'expired', decided_at = now()
       WHERE status = 'pending' AND expires_at <= now()`,
    )
  } catch (error) {
    if (isMissingTable(error)) return
    throw error
  }
}

export async function enqueueMcpPendingAction(input: {
  toolName: McpPendingToolName
  summary: string
  payload: Record<string, unknown>
  me: MeUser
  expiresInHours?: number
}): Promise<McpPendingActionRow> {
  const subject = String(input.me.id || '').trim()
  if (!subject) throw new Error('Authentication required')
  const userPk = await resolveAppUserPk(subject)
  if (!userPk) throw new Error('User not found')

  const summary = String(input.summary || '').trim()
  if (!summary) throw new Error('summary is required')
  const hours = Math.min(
    Math.max(Math.trunc(Number(input.expiresInHours) || DEFAULT_TTL_HOURS), 1),
    168,
  )
  const id = randomUUID()
  const credentialId = input.me.mcpCredentialId
    ? String(input.me.mcpCredentialId)
    : null

  const rows = await query<Record<string, unknown>>(
    `INSERT INTO public.app_mcp_pending_actions (
       id, tool_name, summary, payload, status,
       requested_by_user_id, mcp_credential_id, expires_at
     ) VALUES (
       $1::uuid, $2, $3, $4::jsonb, 'pending',
       $5::uuid, $6::uuid, now() + ($7::int * interval '1 hour')
     )
     RETURNING *`,
    [
      id,
      input.toolName,
      summary,
      JSON.stringify(input.payload ?? {}),
      userPk,
      credentialId,
      hours,
    ],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to enqueue MCP pending action')
  return mapRow(row)
}

export async function listMcpPendingActions(options?: {
  status?: McpPendingStatus | null
  limit?: number
}): Promise<McpPendingActionRow[]> {
  await expireStalePendingActions()
  const limit = Math.min(Math.max(Number(options?.limit) || 50, 1), 200)
  const status = options?.status ? String(options.status) : null
  const rows = await query<Record<string, unknown>>(
    `SELECT *
     FROM public.app_mcp_pending_actions
     WHERE ($1::text IS NULL OR status = $1)
     ORDER BY
       CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
       requested_at DESC
     LIMIT $2`,
    [status, limit],
  )
  return rows.map(mapRow)
}

export async function getMcpPendingAction(
  id: string,
): Promise<McpPendingActionRow | null> {
  await expireStalePendingActions()
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM public.app_mcp_pending_actions WHERE id = $1::uuid LIMIT 1`,
    [id],
  )
  return rows[0] ? mapRow(rows[0]) : null
}

/** Load MeUser for the original requester (execution identity). */
export async function loadRequesterMe(
  requestedByUserId: string,
): Promise<MeUser> {
  const rows = await query<{ backend_user_id: string | null; id: string }>(
    `SELECT id::text AS id, backend_user_id
     FROM public.app_users
     WHERE id = $1::uuid AND COALESCE(is_active, true) = true
     LIMIT 1`,
    [requestedByUserId],
  )
  const row = rows[0]
  if (!row) throw new Error('Requester user not found or inactive')
  const subject =
    typeof row.backend_user_id === 'string' && row.backend_user_id.trim()
      ? row.backend_user_id.trim()
      : row.id
  const me = await postgresFetchMe(subject)
  if (!me?.id) throw new Error('Requester session identity unavailable')
  return me as MeUser
}

export async function rejectMcpPendingAction(input: {
  id: string
  decidedByUserId: string
  note?: string | null
}): Promise<McpPendingActionRow> {
  const rows = await query<Record<string, unknown>>(
    `UPDATE public.app_mcp_pending_actions
     SET status = 'rejected',
         decided_at = now(),
         decided_by_user_id = $2::uuid,
         decision_note = $3
     WHERE id = $1::uuid
       AND status = 'pending'
       AND expires_at > now()
     RETURNING *`,
    [input.id, input.decidedByUserId, input.note?.trim() || null],
  )
  if (!rows[0]) {
    const existing = await getMcpPendingAction(input.id)
    if (!existing) throw new Error('Pending action not found')
    if (existing.status !== 'pending') {
      throw new Error(`Pending action is ${existing.status}, not pending`)
    }
    throw new Error('Pending action expired')
  }
  return mapRow(rows[0])
}

/**
 * Claim a pending row for execution (status → approved) so two admins cannot
 * double-run. Caller must then mark executed/failed.
 */
export async function claimMcpPendingForApproval(input: {
  id: string
  decidedByUserId: string
}): Promise<McpPendingActionRow> {
  await expireStalePendingActions()
  const rows = await query<Record<string, unknown>>(
    `UPDATE public.app_mcp_pending_actions
     SET status = 'approved',
         decided_at = now(),
         decided_by_user_id = $2::uuid
     WHERE id = $1::uuid
       AND status = 'pending'
       AND expires_at > now()
     RETURNING *`,
    [input.id, input.decidedByUserId],
  )
  if (!rows[0]) {
    const existing = await getMcpPendingAction(input.id)
    if (!existing) throw new Error('Pending action not found')
    if (existing.status !== 'pending') {
      throw new Error(`Pending action is ${existing.status}, not pending`)
    }
    throw new Error('Pending action expired')
  }
  return mapRow(rows[0])
}

export async function finalizeClaimedPending(input: {
  id: string
  status: 'executed' | 'failed'
  result: Record<string, unknown>
}): Promise<McpPendingActionRow> {
  const rows = await query<Record<string, unknown>>(
    `UPDATE public.app_mcp_pending_actions
     SET status = $2,
         result = $3::jsonb
     WHERE id = $1::uuid
       AND status = 'approved'
     RETURNING *`,
    [input.id, input.status, JSON.stringify(input.result)],
  )
  if (!rows[0]) throw new Error('Pending action claim lost')
  return mapRow(rows[0])
}
