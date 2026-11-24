import { beforeEach, describe, expect, it, vi } from 'vitest'

const findOneRecord = vi.fn()
const updateRecord = vi.fn()
const writeAuditEntry = vi.fn()
const assertFieldsEditable = vi.fn()
const assertMeEntityPermission = vi.fn()
const redactRecordForMe = vi.fn()
const query = vi.fn()

vi.mock('../adapters/records/facade.js', () => ({
  findOneRecord: (...args: unknown[]) => findOneRecord(...args),
  updateRecord: (...args: unknown[]) => updateRecord(...args),
  SYSTEM_RECORD_ACCESS: Object.freeze({ system: true }),
}))

vi.mock('../audit/auditService.js', () => ({
  writeAuditEntry: (...args: unknown[]) => writeAuditEntry(...args),
}))

vi.mock('../db/pool.js', () => ({
  query: (...args: unknown[]) => query(...args),
}))

vi.mock('../services/fieldSecurity.js', () => ({
  assertFieldsEditable: (...args: unknown[]) => assertFieldsEditable(...args),
  redactRecordForMe: (...args: unknown[]) => redactRecordForMe(...args),
}))

vi.mock('../services/rolePermissions.js', () => ({
  assertMeEntityPermission: (...args: unknown[]) => assertMeEntityPermission(...args),
  resolveAppRoleId: vi.fn(),
}))

vi.mock('./flowAuth.js', () => ({
  outboundHttpFlowHeaders: vi.fn(),
  resolveN8nFlowUrl: vi.fn(),
}))

vi.mock('./flowDispatchLog.js', () => ({
  flowDispatchContext: vi.fn(() => ({})),
  recordFlowDispatchFailure: vi.fn(),
}))

vi.mock('./httpFlowAuth.js', () => ({
  applyHttpFlowAuthHeaders: vi.fn(),
}))

vi.mock('./outboundHttp.js', () => ({
  assertOutboundUrlShape: vi.fn(),
  guardedFlowFetch: vi.fn(),
}))

import { LocalFlowError, runLocalFlow } from './localFlows.js'

describe('localFlows update_record FLS', () => {
  const me = {
    id: 'user-1',
    adminAccess: false,
    roleAdminAccess: false,
  }

  beforeEach(() => {
    findOneRecord.mockReset()
    updateRecord.mockReset()
    writeAuditEntry.mockReset()
    assertFieldsEditable.mockReset()
    assertMeEntityPermission.mockReset()
    redactRecordForMe.mockReset()
    query.mockReset()

    query.mockResolvedValueOnce([
      {
        key: 'raise-salary',
        enabled: true,
        handler: 'update_record',
        config: {
          collection: 'employee',
          allowedFields: ['name'],
          patch: { salary: 999 },
        },
        description: null,
      },
    ])
    findOneRecord.mockResolvedValue({ id: 'rec-1', salary: 100 })
    updateRecord.mockResolvedValue({ id: 'rec-1', salary: 999 })
    redactRecordForMe.mockImplementation(async (_me, _c, record) => record)
    writeAuditEntry.mockResolvedValue(undefined)
  })

  it('rejects JWT callers when merged config.patch includes non-editable fields', async () => {
    assertMeEntityPermission.mockResolvedValue(undefined)
    assertFieldsEditable.mockRejectedValue(new Error('Field not editable: salary'))

    await expect(
      runLocalFlow(
        'raise-salary',
        { recordId: 'rec-1', data: { name: 'Ada' } },
        { kind: 'user', me: me as never },
      ),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/salary|Permission denied/i),
    } satisfies Partial<LocalFlowError>)

    expect(assertFieldsEditable).toHaveBeenCalledWith(
      me,
      'employee',
      expect.arrayContaining(['salary', 'name']),
    )
    expect(updateRecord).not.toHaveBeenCalled()
  })

  it('allows system invokers to apply config.patch without caller FLS', async () => {
    await runLocalFlow('raise-salary', { recordId: 'rec-1' }, { kind: 'system' })
    expect(assertFieldsEditable).not.toHaveBeenCalled()
    expect(updateRecord).toHaveBeenCalled()
  })
})
