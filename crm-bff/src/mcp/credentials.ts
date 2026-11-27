/**
 * Dedicated MCP credentials — opaque Bearer tokens independent of web sessions.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import { postgresFetchMe } from '../adapters/postgresUsers.js'
import type { MeUser } from '../adapters/usersAdapter.js'

export const MCP_TOKEN_PREFIX = 'ce_mcp_'

export type McpCredentialScope = 'read' | 'write' | 'schema'

export type McpCredentialRow = {
  id: string
  label: string
  scopes: McpCredentialScope[]
  expiresAt: string
  revokedAt: string | null
  createdAt: string
  lastUsedAt: string | null
  userId: string
}

const ALLOWED_SCOPES = new Set<McpCredentialScope>(['read', 'write', 'schema'])

export function isMcpCredentialToken(token: string): boolean {
  return token.startsWith(MCP_TOKEN_PREFIX)
}

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function normalizeMcpScopes(raw: unknown): McpCredentialScope[] {
  const list = Array.isArray(raw) ? raw : ['read']
  const out: McpCredentialScope[] = []
  for (const item of list) {
    const scope = String(item || '')
      .trim()
      .toLowerCase() as McpCredentialScope
    if (ALLOWED_SCOPES.has(scope) && !out.includes(scope)) out.push(scope)
  }
  return out.length ? out : (['read'] as McpCredentialScope[])
}

function mapRow(row: Record<string, unknown>): McpCredentialRow {
  return {
    id: String(row.id),
    label: String(row.label),
    scopes: normalizeMcpScopes(row.scopes),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastUsedAt: row.last_used_at
      ? new Date(String(row.last_used_at)).toISOString()
      : null,
    userId: String(row.user_id),
  }
}

function isMissingTable(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    if ((error as { code?: string }).code === '42P01') return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /app_mcp_credentials/i.test(message) && /does not exist/i.test(message)
}

/** Resolve Bearer token → MeUser with mcpScopes when it is a live MCP credential. */
export async function resolveMeFromMcpToken(token: string): Promise<MeUser | null> {
  if (!isMcpCredentialToken(token)) return null
  const tokenHash = hashMcpToken(token)
  try {
    const rows = await query<Record<string, unknown>>(
      `SELECT c.id, c.user_id, c.scopes, c.expires_at, u.backend_user_id
       FROM public.app_mcp_credentials c
       INNER JOIN public.app_users u ON u.id = c.user_id
       WHERE c.token_hash = $1
         AND c.revoked_at IS NULL
         AND c.expires_at > now()
         AND COALESCE(u.is_active, true) = true
       LIMIT 1`,
      [tokenHash],
    )
    const row = rows[0]
    if (!row) return null
    const subject =
      typeof row.backend_user_id === 'string' && row.backend_user_id.trim()
        ? row.backend_user_id.trim()
        : String(row.user_id)
    const me = await postgresFetchMe(subject)
    if (!me?.id) return null
    // Touch last_used (best-effort).
    void query(
      `UPDATE public.app_mcp_credentials SET last_used_at = now() WHERE id = $1::uuid`,
      [String(row.id)],
    ).catch(() => undefined)
    return {
      ...me,
      mcpScopes: normalizeMcpScopes(row.scopes),
      mcpCredentialId: String(row.id),
    }
  } catch (error) {
    if (isMissingTable(error)) return null
    throw error
  }
}

/** Resolve app_users UUID PK from session subject (backend_user_id or id text). */
export async function resolveAppUserPk(subjectId: string): Promise<string | null> {
  const id = String(subjectId || '').trim()
  if (!id) return null
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id
     FROM public.app_users
     WHERE backend_user_id = $1 OR id::text = $1
     LIMIT 1`,
    [id],
  )
  return rows[0]?.id ?? null
}

export async function listMcpCredentials(userId: string): Promise<McpCredentialRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, user_id, label, scopes, expires_at, revoked_at, created_at, last_used_at
     FROM public.app_mcp_credentials
     WHERE user_id = $1::uuid
     ORDER BY created_at DESC`,
    [userId],
  )
  return rows.map(mapRow)
}

export async function createMcpCredential(input: {
  /** app_users.id (UUID PK). */
  userId: string
  label: string
  scopes?: unknown
  /** Hours until expiry (1–720). Default 24. */
  expiresInHours?: number
}): Promise<{ credential: McpCredentialRow; token: string }> {
  const label = String(input.label || '').trim()
  if (!label) throw new Error('label is required')
  const scopes = normalizeMcpScopes(input.scopes)
  const hours = Math.min(
    Math.max(Math.trunc(Number(input.expiresInHours) || 24), 1),
    720,
  )
  const id = randomUUID()
  const token = `${MCP_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  const tokenHash = hashMcpToken(token)
  const rows = await query<Record<string, unknown>>(
    `INSERT INTO public.app_mcp_credentials (
       id, user_id, label, token_hash, scopes, expires_at
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5::text[], now() + ($6::int * interval '1 hour')
     )
     RETURNING id, user_id, label, scopes, expires_at, revoked_at, created_at, last_used_at`,
    [id, input.userId, label, tokenHash, scopes, hours],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to create MCP credential')
  return { credential: mapRow(row), token }
}

export async function revokeMcpCredential(input: {
  id: string
  userId: string
}): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE public.app_mcp_credentials
     SET revoked_at = now()
     WHERE id = $1::uuid
       AND user_id = $2::uuid
       AND revoked_at IS NULL
     RETURNING id`,
    [input.id, input.userId],
  )
  return Boolean(rows[0]?.id)
}
