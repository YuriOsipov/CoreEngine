/**
 * Resolve MCP request auth into MeUser with admin / user guards.
 */
import type { MeUser } from '../adapters/usersAdapter.js'
import {
  requireAdminAccess,
  requireAuthenticatedUser,
  type AuthContext,
} from '../auth/accessGuards.js'
import { mcpSchemaWriteEnabled } from './limits.js'
import {
  credentialAllows,
  getToolPolicy,
  type McpToolName,
  type McpToolScope,
} from './toolPolicy.js'

export type McpRequestContext = AuthContext & {
  /** Set per HTTP request; tools close over this. */
  me?: MeUser
}

export async function resolveMcpUser(
  ctx: AuthContext,
  scope: McpToolScope,
): Promise<MeUser> {
  if (scope === 'admin') {
    return requireAdminAccess(ctx)
  }
  return requireAuthenticatedUser(ctx)
}

export async function assertToolAccess(
  ctx: AuthContext,
  toolName: McpToolName,
): Promise<MeUser> {
  const policy = getToolPolicy(toolName)
  if (!policy) {
    throw new Error(`Unknown MCP tool: ${toolName}`)
  }
  if (policy.schemaWrite && !mcpSchemaWriteEnabled()) {
    throw new Error(
      `${toolName} is disabled until MCP_SCHEMA_WRITE_ENABLED=true ` +
        '(schema/layout writes are high-risk for LLM clients; see docs/mcp.md)',
    )
  }
  const me = await resolveMcpUser(ctx, policy.scope)
  // Dedicated MCP credentials carry explicit scopes; web session JWTs do not.
  if (me.mcpScopes != null) {
    if (!credentialAllows(me.mcpScopes, policy.mcpScope)) {
      throw new Error(
        `${toolName} requires MCP credential scope "${policy.mcpScope}" ` +
          `(credential has: ${me.mcpScopes.join(', ') || 'none'})`,
      )
    }
  }
  return me
}

export function authContextFromHeaders(headers: {
  authorization?: string | string[] | null
  'x-role-preview'?: string | string[] | null
}): AuthContext {
  const authorization = Array.isArray(headers.authorization)
    ? headers.authorization[0] ?? null
    : headers.authorization ?? null
  const rolePreviewRaw = headers['x-role-preview']
  const rolePreview = Array.isArray(rolePreviewRaw)
    ? rolePreviewRaw[0] ?? null
    : rolePreviewRaw ?? null
  return { authorization, rolePreview }
}
