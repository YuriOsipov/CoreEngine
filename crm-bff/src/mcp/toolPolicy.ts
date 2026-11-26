/**
 * MCP tool registry policy — every registered tool must appear here.
 * Scopes: admin (Setup) vs operator (records / support).
 */

export type McpToolScope = 'admin' | 'operator'

export type McpToolPolicy = {
  scope: McpToolScope
  /** When true, tool args must include confirm: true */
  confirmRequired?: boolean
}

export const MCP_TOOL_POLICY = {
  list_objects: { scope: 'admin' },
  inspect_schema: { scope: 'admin' },
  upsert_object_schema: { scope: 'admin' },
  update_role_layout: { scope: 'admin' },
  export_domain_pack: { scope: 'admin' },
  validate_domain_pack: { scope: 'admin' },
  query_records: { scope: 'operator' },
  create_record: { scope: 'operator' },
  update_record: { scope: 'operator' },
  inspect_flow_logs: { scope: 'admin' },
  retry_message: { scope: 'operator', confirmRequired: true },
} as const satisfies Record<string, McpToolPolicy>

export type McpToolName = keyof typeof MCP_TOOL_POLICY

export const MCP_TOOL_NAMES = Object.keys(MCP_TOOL_POLICY) as McpToolName[]

export function getToolPolicy(name: string): McpToolPolicy | null {
  if (name in MCP_TOOL_POLICY) {
    return MCP_TOOL_POLICY[name as McpToolName]
  }
  return null
}

export function assertConfirm(
  toolName: McpToolName,
  args: { confirm?: boolean },
): void {
  const policy: McpToolPolicy = MCP_TOOL_POLICY[toolName]
  if (policy.confirmRequired && args.confirm !== true) {
    throw new Error(
      `${toolName} requires confirm: true (destructive / re-dispatch action)`,
    )
  }
}
