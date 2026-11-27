/**
 * MCP tool registry policy — every registered tool must appear here.
 *
 * Scopes:
 * - admin: requires app admin (Setup tools)
 * - user: any authenticated app user (object ACL still applies per tool)
 *
 * mcpScope: required when the caller authenticated with a dedicated MCP credential.
 * Web session JWTs have no mcpScopes and skip that check.
 *
 * approvalRequired: tool only enqueues a pending action; a human must approve
 * in Setup → MCP before side effects run. Model-set booleans are not approval.
 */

export type McpToolScope = 'admin' | 'user'

export type McpCredentialScopeNeed = 'read' | 'write' | 'schema'

export type McpToolPolicy = {
  scope: McpToolScope
  /** Enqueues pending action; human UI approval required before execute. */
  approvalRequired?: boolean
  /** Requires MCP_SCHEMA_WRITE_ENABLED=true (default off) even to enqueue. */
  schemaWrite?: boolean
  /** Required MCP credential scope (read ⊂ write ⊂ schema for gating). */
  mcpScope: McpCredentialScopeNeed
}

export const MCP_TOOL_POLICY = {
  list_objects: { scope: 'admin', mcpScope: 'read' },
  inspect_schema: { scope: 'admin', mcpScope: 'read' },
  upsert_object_schema: {
    scope: 'admin',
    schemaWrite: true,
    approvalRequired: true,
    mcpScope: 'schema',
  },
  update_role_layout: {
    scope: 'admin',
    schemaWrite: true,
    approvalRequired: true,
    mcpScope: 'schema',
  },
  export_domain_pack: { scope: 'admin', mcpScope: 'read' },
  validate_domain_pack: { scope: 'admin', mcpScope: 'read' },
  query_records: { scope: 'user', mcpScope: 'read' },
  create_record: { scope: 'user', mcpScope: 'write' },
  update_record: { scope: 'user', mcpScope: 'write' },
  inspect_flow_logs: { scope: 'admin', mcpScope: 'read' },
  retry_message: {
    scope: 'user',
    approvalRequired: true,
    mcpScope: 'write',
  },
} as const satisfies Record<string, McpToolPolicy>

export type McpToolName = keyof typeof MCP_TOOL_POLICY

export const MCP_TOOL_NAMES = Object.keys(MCP_TOOL_POLICY) as McpToolName[]

export function getToolPolicy(name: string): McpToolPolicy | null {
  if (name in MCP_TOOL_POLICY) {
    return MCP_TOOL_POLICY[name as McpToolName]
  }
  return null
}

/** Credential scopes: schema implies write+read; write implies read. */
export function credentialAllows(
  scopes: string[] | null | undefined,
  need: McpCredentialScopeNeed,
): boolean {
  if (!scopes || !scopes.length) return false
  const set = new Set(scopes.map((s) => String(s).toLowerCase()))
  if (need === 'read') return set.has('read') || set.has('write') || set.has('schema')
  if (need === 'write') return set.has('write') || set.has('schema')
  return set.has('schema')
}
