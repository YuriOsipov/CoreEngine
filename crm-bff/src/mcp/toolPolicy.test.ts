import { describe, expect, it } from 'vitest'
import {
  assertConfirm,
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
      expect(['admin', 'operator']).toContain(policy!.scope)
    }
  })

  it('marks admin setup tools as admin scope', () => {
    expect(MCP_TOOL_POLICY.list_objects.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.inspect_schema.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.upsert_object_schema.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.update_role_layout.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.export_domain_pack.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.validate_domain_pack.scope).toBe('admin')
    expect(MCP_TOOL_POLICY.inspect_flow_logs.scope).toBe('admin')
  })

  it('marks operator record tools as operator scope', () => {
    expect(MCP_TOOL_POLICY.query_records.scope).toBe('operator')
    expect(MCP_TOOL_POLICY.create_record.scope).toBe('operator')
    expect(MCP_TOOL_POLICY.update_record.scope).toBe('operator')
    expect(MCP_TOOL_POLICY.retry_message.scope).toBe('operator')
  })

  it('requires confirm for retry_message', () => {
    expect(() =>
      assertConfirm('retry_message', { confirm: false }),
    ).toThrow(/confirm/)
    expect(() => assertConfirm('retry_message', { confirm: true })).not.toThrow()
  })
})
