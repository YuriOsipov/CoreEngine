/**
 * MCP field-leak / FLS cases: record tools must use the same facade path as GraphQL
 * (dotted-key filters, restricted sorts, related search, redaction). Aggregates and
 * document payloads are intentionally not MCP tools.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const assertToolAccess = vi.fn()
const assertMeEntityPermission = vi.fn()
const findManyRecords = vi.fn()
const findOneRecord = vi.fn()
const createRecord = vi.fn()
const updateRecord = vi.fn()
const redactRecordForMe = vi.fn()
const auditAfterMutation = vi.fn(async (opts: { audit: () => Promise<void> }) => {
  await opts.audit()
})
const writeAuditEntry = vi.fn()
const actorIdFromMe = vi.fn(() => 'user-1')

vi.mock('../auth.js', () => ({
  assertToolAccess: (...args: unknown[]) =>
    (assertToolAccess as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('../../services/rolePermissions.js', () => ({
  assertMeEntityPermission: (...args: unknown[]) =>
    (assertMeEntityPermission as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('../../adapters/records/facade.js', () => ({
  findManyRecords: (...args: unknown[]) =>
    (findManyRecords as (...a: unknown[]) => unknown)(...args),
  findOneRecord: (...args: unknown[]) =>
    (findOneRecord as (...a: unknown[]) => unknown)(...args),
  createRecord: (...args: unknown[]) =>
    (createRecord as (...a: unknown[]) => unknown)(...args),
  updateRecord: (...args: unknown[]) =>
    (updateRecord as (...a: unknown[]) => unknown)(...args),
  SYSTEM_RECORD_ACCESS: { system: true },
}))

vi.mock('../../services/fieldSecurity.js', () => ({
  redactRecordForMe: (...args: unknown[]) =>
    (redactRecordForMe as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('../../audit/auditAfterMutation.js', () => ({
  auditAfterMutation: (...args: unknown[]) =>
    (auditAfterMutation as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('../../audit/auditService.js', () => ({
  writeAuditEntry: (...args: unknown[]) =>
    (writeAuditEntry as (...a: unknown[]) => unknown)(...args),
}))

vi.mock('../../auth/rolePreview.js', () => ({
  actorIdFromMe: (...args: unknown[]) =>
    (actorIdFromMe as (...a: unknown[]) => unknown)(...args),
}))

import { MCP_TOOL_NAMES } from '../toolPolicy.js'
import {
  runMcpCreateRecord,
  runMcpQueryRecords,
  runMcpUpdateRecord,
} from './records.js'

const me = {
  id: 'user-1',
  adminAccess: false,
  mcpScopes: ['write'],
  mcpCredentialId: 'cred-1',
}

const ctx = { authorization: 'Bearer ce_mcp_test' }

describe('MCP record tools FLS / field-leak path', () => {
  beforeEach(() => {
    assertToolAccess.mockReset()
    assertMeEntityPermission.mockReset()
    findManyRecords.mockReset()
    findOneRecord.mockReset()
    createRecord.mockReset()
    updateRecord.mockReset()
    redactRecordForMe.mockReset()
    writeAuditEntry.mockReset()
    assertToolAccess.mockResolvedValue(me)
    assertMeEntityPermission.mockResolvedValue(undefined)
    redactRecordForMe.mockImplementation(
      async (_me: unknown, _entity: string, row: Record<string, unknown>) => row,
    )
  })

  it('does not expose aggregate or document tools (payloads stay off MCP)', () => {
    const names = MCP_TOOL_NAMES as string[]
    expect(names).toContain('query_records')
    expect(names).not.toContain('aggregate_records')
    expect(names).not.toContain('generate_document')
    expect(names).not.toContain('generateDocument')
    expect(names.some((n) => /aggregat|document/i.test(n))).toBe(false)
  })

  it('forwards filter, sort, and search to findManyRecords with access.me', async () => {
    findManyRecords.mockResolvedValue({ nodes: [{ id: '1', name: 'Acme' }], totalCount: 1 })
    const result = await runMcpQueryRecords(ctx, {
      entity: 'opportunity',
      filter: { 'account.name': { _eq: 'Acme' } },
      sort: ['account.name'],
      search: 'Acme',
      limit: 10,
    })
    expect(result.isError).toBeUndefined()
    expect(findManyRecords).toHaveBeenCalledWith(
      'opportunity',
      expect.objectContaining({
        filter: { 'account.name': { _eq: 'Acme' } },
        sort: ['account.name'],
        search: 'Acme',
        access: { me },
      }),
    )
    expect(redactRecordForMe).toHaveBeenCalled()
  })

  it('surfaces dotted-key filter denials from the facade', async () => {
    findManyRecords.mockRejectedValue(
      new Error('Permission denied: read on account.margin'),
    )
    const result = await runMcpQueryRecords(ctx, {
      entity: 'opportunity',
      filter: { 'account.margin': { _gt: 0 } },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/account\.margin/)
  })

  it('surfaces nested M2O filter denials (same as GraphQL hop walk)', async () => {
    findManyRecords.mockRejectedValue(
      new Error('Permission denied: read on account.margin'),
    )
    const result = await runMcpQueryRecords(ctx, {
      entity: 'opportunity',
      filter: { account: { margin: { _gt: 0 } } },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/account\.margin/)
  })

  it('surfaces sorting on a restricted field', async () => {
    findManyRecords.mockRejectedValue(
      new Error('Permission denied: read on employee.salary'),
    )
    const result = await runMcpQueryRecords(ctx, {
      entity: 'employee',
      sort: ['-salary'],
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/employee\.salary/)
  })

  it('forwards related search so M2O search FLS applies in the facade', async () => {
    findManyRecords.mockRejectedValue(
      new Error('Permission denied: read on account.margin'),
    )
    const result = await runMcpQueryRecords(ctx, {
      entity: 'opportunity',
      search: 'secret-margin-oracle',
    })
    expect(findManyRecords).toHaveBeenCalledWith(
      'opportunity',
      expect.objectContaining({
        search: 'secret-margin-oracle',
        access: { me },
      }),
    )
    expect(result.isError).toBe(true)
  })

  it('redacts get-by-id results via redactRecordForMe', async () => {
    findOneRecord.mockResolvedValue({ id: 'e1', salary: 120000, name: 'Ada' })
    redactRecordForMe.mockResolvedValue({ id: 'e1', name: 'Ada' })
    const result = await runMcpQueryRecords(ctx, {
      entity: 'employee',
      id: 'e1',
    })
    expect(findOneRecord).toHaveBeenCalledWith('employee', 'e1', null, { me })
    expect(redactRecordForMe).toHaveBeenCalledWith(me, 'employee', {
      id: 'e1',
      salary: 120000,
      name: 'Ada',
    })
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      record: { id: 'e1', name: 'Ada' },
    })
    expect(JSON.parse(result.content[0]!.text).record.salary).toBeUndefined()
  })

  it('redacts create_record results', async () => {
    createRecord.mockResolvedValue({ id: 'n1', salary: 99, name: 'Neo' })
    redactRecordForMe.mockResolvedValue({ id: 'n1', name: 'Neo' })
    const result = await runMcpCreateRecord(ctx, {
      entity: 'employee',
      data: { name: 'Neo', salary: 99 },
    })
    expect(createRecord).toHaveBeenCalledWith(
      'employee',
      { name: 'Neo', salary: 99 },
      null,
      expect.objectContaining({ access: { me } }),
    )
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0]!.text).record.salary).toBeUndefined()
  })

  it('redacts update_record results', async () => {
    findOneRecord.mockResolvedValue({ id: 'e1', name: 'Ada' })
    updateRecord.mockResolvedValue({ id: 'e1', salary: 1, name: 'Ada' })
    redactRecordForMe.mockResolvedValue({ id: 'e1', name: 'Ada' })
    const result = await runMcpUpdateRecord(ctx, {
      entity: 'employee',
      id: 'e1',
      data: { name: 'Ada' },
    })
    expect(updateRecord).toHaveBeenCalledWith(
      'employee',
      'e1',
      { name: 'Ada' },
      null,
      expect.objectContaining({ access: { me } }),
    )
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0]!.text).record.salary).toBeUndefined()
  })
})
