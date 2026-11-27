import { getAccessToken } from '@/core/auth/session'
import { bffBaseUrl } from './filesProxy'

export type McpCredentialScope = 'read' | 'write' | 'schema'

export type McpCredentialDto = {
  id: string
  label: string
  scopes: McpCredentialScope[]
  expiresAt: string
  revokedAt: string | null
  createdAt: string
  lastUsedAt: string | null
  userId: string
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function parseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null
  const message =
    body && typeof body === 'object' && typeof body.error === 'string'
      ? body.error.trim()
      : ''
  return message || `HTTP ${response.status}`
}

export async function fetchMcpCredentials(): Promise<McpCredentialDto[]> {
  const response = await fetch(`${bffBaseUrl()}/api/v1/mcp/credentials`, {
    method: 'GET',
    headers: await authHeaders(),
    credentials: 'include',
  })
  if (!response.ok) throw new Error(await parseError(response))
  const body = (await response.json()) as { nodes?: McpCredentialDto[] }
  return Array.isArray(body.nodes) ? body.nodes : []
}

export async function createMcpCredential(input: {
  label: string
  scopes: McpCredentialScope[]
  expiresInHours: number
}): Promise<{ credential: McpCredentialDto; token: string }> {
  const response = await fetch(`${bffBaseUrl()}/api/v1/mcp/credentials`, {
    method: 'POST',
    headers: await authHeaders(),
    credentials: 'include',
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(await parseError(response))
  const body = (await response.json()) as {
    credential?: McpCredentialDto
    token?: string
  }
  if (!body.credential || !body.token) {
    throw new Error('Invalid create MCP credential response')
  }
  return { credential: body.credential, token: body.token }
}

export async function revokeMcpCredential(id: string): Promise<void> {
  const response = await fetch(
    `${bffBaseUrl()}/api/v1/mcp/credentials/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: await authHeaders(),
      credentials: 'include',
    },
  )
  if (!response.ok) throw new Error(await parseError(response))
}

export type McpPendingStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'expired'

export type McpPendingActionDto = {
  id: string
  toolName: string
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

export async function fetchMcpPendingActions(options?: {
  status?: McpPendingStatus | null
}): Promise<McpPendingActionDto[]> {
  const params = new URLSearchParams()
  if (options?.status) params.set('status', options.status)
  const qs = params.toString()
  const response = await fetch(
    `${bffBaseUrl()}/api/v1/mcp/pending-actions${qs ? `?${qs}` : ''}`,
    {
      method: 'GET',
      headers: await authHeaders(),
      credentials: 'include',
    },
  )
  if (!response.ok) throw new Error(await parseError(response))
  const body = (await response.json()) as { nodes?: McpPendingActionDto[] }
  return Array.isArray(body.nodes) ? body.nodes : []
}

export async function approveMcpPendingAction(
  id: string,
): Promise<McpPendingActionDto> {
  const response = await fetch(
    `${bffBaseUrl()}/api/v1/mcp/pending-actions/${encodeURIComponent(id)}/approve`,
    {
      method: 'POST',
      headers: await authHeaders(),
      credentials: 'include',
      body: '{}',
    },
  )
  if (!response.ok) throw new Error(await parseError(response))
  const body = (await response.json()) as { action?: McpPendingActionDto }
  if (!body.action) throw new Error('Invalid approve response')
  return body.action
}

export async function rejectMcpPendingAction(
  id: string,
  note?: string,
): Promise<McpPendingActionDto> {
  const response = await fetch(
    `${bffBaseUrl()}/api/v1/mcp/pending-actions/${encodeURIComponent(id)}/reject`,
    {
      method: 'POST',
      headers: await authHeaders(),
      credentials: 'include',
      body: JSON.stringify({ note: note || null }),
    },
  )
  if (!response.ok) throw new Error(await parseError(response))
  const body = (await response.json()) as { action?: McpPendingActionDto }
  if (!body.action) throw new Error('Invalid reject response')
  return body.action
}
