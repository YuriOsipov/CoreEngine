import { describe, expect, it } from 'vitest'
import {
  credentialAllows,
  getToolPolicy,
  MCP_TOOL_NAMES,
  MCP_TOOL_POLICY,
} from './toolPolicy.js'

describe('MCP toolPolicy', () => {
  it('classifies every catalog tool', () => {
    expect(MCP_TOOL_NAMES.length).toBeGreaterThanOrEqual(11)
    for (const name of MCP_TOOL_NAMES) {
      const policy = getToolPolicy(name)
      expect(policy).toBeTruthy()
      expect(['admin', 'user']).toContain(policy!.scope)
      expect(['read', 'write', 'schema']).toContain(policy!.mcpScope)
    }
  })

  it('marks admin setup tools as admin scope', () => {
    expect(MCP_TOOL_POLICY.list_objects.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.inspect_schema.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.upsert_object_schema.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.upsert_object_schema.schemaWrite).toBe(true)
    expect(MCP_TOOL_POLICY.upsert_object_schema.approvalRequired).toBe(true)
    expect(MCP_TOOL_POLICY.upsert_object_schema.mcpScope).toBe('schema')
    expect(MCP_TOOL_POLICY.update_role_layout.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.update_role_layout.schemaWrite).toBe(true)
    expect(MCP_TOOL_POLICY.update_role_layout.approvalRequired).toBe(true)
    expect(MCP_TOOL_POLICY.export_domain_pack.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.validate_domain_pack.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.inspect_flow_logs.scope).toBe('admin')
  })

  it('marks record tools as user scope', () => {
    expect(MCP_TOOL_POLICY.query_records.scope).toBe('user')
    expect(MCP_TOOL_POLICY.query_records.mcpScope).toBe('read')
    expect(MCP_TOOL_POLICY.create_record.scope).toBe('user')
    expect(MCP_TOOL_POLICY.create_record.mcpScope).toBe('write')
    expect(MCP_TOOL_POLICY.update_record.scope).toBe('user')
    expect(MCP_TOOL_POLICY.retry_message.scope).toBe('user')
    expect(MCP_TOOL_POLICY.retry_message.approvalRequired).toBe(true)
  })

  it('credentialAllows respects read ⊂ write ⊂ schema', () => {
    expect(credentialAllows(['read'], 'read')).toBe(true)
    expect(credentialAllows(['read'], 'write')).toBe(false)
    expect(credentialAllows(['write'], 'read')).toBe(true)
    expect(credentialAllows(['write'], 'write')).toBe(true)
    expect(credentialAllows(['write'], 'schema')).toBe(false)
    expect(credentialAllows(['schema'], 'read')).toBe(true)
    expect(credentialAllows(['schema'], 'write')).toBe(true)
    expect(credentialAllows(['schema'], 'schema')).toBe(true)
    expect(credentialAllows([], 'read')).toBe(false)
  })
})
