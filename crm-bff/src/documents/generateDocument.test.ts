import { beforeEach, describe, expect, it, vi } from 'vitest'

const assertMeEntityPermission = vi.fn()
const resolveFieldAccess = vi.fn()
const findOneRecord = vi.fn()
const findManyRecords = vi.fn()
const createRecord = vi.fn()
const updateRecord = vi.fn()
const uploadFileBuffer = vi.fn()
const renderDocumentOutput = vi.fn()
vi.mock('../services/rolePermissions.js', () => ({
  assertMeEntityPermission: (...args: unknown[]) => assertMeEntityPermission(...args),
}))
vi.mock('../services/fieldSecurity.js', () => ({
  resolveFieldAccess: (...args: unknown[]) => resolveFieldAccess(...args),
}))
vi.mock('../adapters/records/facade.js', () => ({
  findOneRecord: (...args: unknown[]) => findOneRecord(...args),
  findManyRecords: (...args: unknown[]) => findManyRecords(...args),
  createRecord: (...args: unknown[]) => createRecord(...args),
  updateRecord: (...args: unknown[]) => updateRecord(...args),
  SYSTEM_RECORD_ACCESS: Object.freeze({ me: null, system: true }),
}))
vi.mock('../adapters/filesAdapter.js', () => ({
  uploadFileBuffer: (...args: unknown[]) => uploadFileBuffer(...args),
}))
vi.mock('./renderDocumentOutput.js', () => ({
  renderDocumentOutput: (...args: unknown[]) => renderDocumentOutput(...args),
}))

import {
  buildGenerateDocumentValues,
  filterValuesOverrideForFieldAccess,
  generateDocument,
  parseGenerateDocumentInput,
} from './generateDocument.js'

const TEMPLATE_BODY = {
  kind: 'template',
  blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'Hi' } }],
  fieldSchemas: {},
}

describe('parseGenerateDocumentInput', () => {
  it('requires collectionName, recordId, and templateId', () => {
    expect(() =>
      parseGenerateDocumentInput({
        collectionName: '',
        recordId: '1',
        templateId: 't1',
      }),
    ).toThrow(/collectionName is required/)
  })

  it('defaults outputFormat to pdf and persist/render to true', () => {
    const parsed = parseGenerateDocumentInput({
      collectionName: 'opportunity',
      recordId: 'rec-1',
      templateId: 'tmpl-1',
    })
    expect(parsed.outputFormat).toBe('pdf')
    expect(parsed.persist).toBe(true)
    expect(parsed.renderOutput).toBe(true)
    expect(parsed.documentStatus).toBe('completed')
  })
})

describe('buildGenerateDocumentValues', () => {
  it('flattens record fields and overlays mapping + overrides', () => {
    const values = buildGenerateDocumentValues(
      {
        id: 'rec-1',
        amount: 100,
        account_id: { id: 'acc-1', name: 'Acme' },
      },
      {
        fields: [{ target: 'deal_amount', path: 'amount' }],
      },
      { note: 'from n8n' },
    )
    expect(values.amount).toBe(100)
    expect(values.account_id).toBe('acc-1')
    expect(values.deal_amount).toBe(100)
    expect(values.note).toBe('from n8n')
  })
})

describe('filterValuesOverrideForFieldAccess', () => {
  it('drops unreadable field keys and mapping targets for those paths', () => {
    const access = {
      entity: 'opportunity',
      unreadable: new Set(['salary', 'cost']),
      uneditable: new Set<string>(),
    }
    const filtered = filterValuesOverrideForFieldAccess(
      {
        salary: 9,
        note: 'ok',
        deal_cost: 1,
      },
      { fields: [{ target: 'deal_cost', path: 'cost' }] },
      access,
    )
    expect(filtered).toEqual({ note: 'ok' })
  })

  it('passes through when access is null (admin / bypass)', () => {
    expect(
      filterValuesOverrideForFieldAccess({ salary: 1 }, {}, null),
    ).toEqual({ salary: 1 })
  })
})

describe('generateDocument (Phase 1 + Phase 2)', () => {
  const me = { id: 'u1' } as never
  const input = {
    collectionName: 'opportunity',
    recordId: 'rec-1',
    templateId: 'tmpl-1',
  }

  beforeEach(() => {
    assertMeEntityPermission.mockReset()
    resolveFieldAccess.mockReset()
    findOneRecord.mockReset()
    findManyRecords.mockReset()
    createRecord.mockReset()
    updateRecord.mockReset()
    uploadFileBuffer.mockReset()
    renderDocumentOutput.mockReset()
    assertMeEntityPermission.mockResolvedValue(me)
    resolveFieldAccess.mockResolvedValue(null)
    findOneRecord.mockImplementation(async (collection: string) => {
      if (collection === 'doc_template') {
        return {
          id: 'tmpl-1',
          name: 'Quote',
          collection: 'opportunity',
          field_mapping: { fields: [{ target: 'amt', path: 'amount' }] },
          body: TEMPLATE_BODY,
        }
      }
      if (collection === 'opportunity') {
        return { id: 'rec-1', amount: 42, name: 'Deal' }
      }
      throw new Error(`Record not found: ${collection}`)
    })
    findManyRecords.mockResolvedValue({ nodes: [{ id: 'snap-1' }] })
    createRecord.mockResolvedValue({ id: 'doc-1' })
    renderDocumentOutput.mockResolvedValue({
      buffer: Buffer.from('%PDF-1.4'),
      mimeType: 'application/pdf',
      filename: 'Quote.pdf',
    })
    uploadFileBuffer.mockResolvedValue({ id: 'file-1' })
  })

  it('persists doc_value, renders PDF, and returns downloadUrl', async () => {
    const result = await generateDocument(me, input)
    expect(result.docValueId).toBe('doc-1')
    expect(result.templateSnapshotId).toBe('snap-1')
    expect(result.values).toMatchObject({ amount: 42, amt: 42 })
    expect(result.outputFileId).toBe('file-1')
    expect(result.downloadUrl).toBe('/assets/file-1')
    expect(renderDocumentOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        templateBody: TEMPLATE_BODY,
        outputFormat: 'pdf',
        title: 'Quote',
      }),
    )
    expect(uploadFileBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'Quote.pdf',
        mimeType: 'application/pdf',
        uploadedBy: 'u1',
        parentCollection: 'opportunity',
        parentRecordId: 'rec-1',
      }),
    )
    expect(createRecord).toHaveBeenCalledWith(
      'doc_value',
      expect.objectContaining({
        parent_collection: 'opportunity',
        parent_id: 'rec-1',
        template: 'tmpl-1',
        document_status: 'completed',
        output_file: 'file-1',
      }),
      ['id'],
      expect.objectContaining({
        access: expect.objectContaining({ system: true }),
      }),
    )
  })

  it('drops Confidential valuesOverride keys for the generating caller', async () => {
    resolveFieldAccess.mockResolvedValue({
      entity: 'opportunity',
      unreadable: new Set(['salary']),
      uneditable: new Set(['salary']),
    })
    const result = await generateDocument(me, {
      ...input,
      persist: false,
      renderOutput: false,
      valuesOverride: {
        salary: 999_999,
        note: 'from automation',
      },
    })
    expect(result.values).toMatchObject({
      amount: 42,
      note: 'from automation',
    })
    expect(result.values).not.toHaveProperty('salary')
  })

  it('skips render when renderOutput=false', async () => {
    const result = await generateDocument(me, {
      ...input,
      renderOutput: false,
    })
    expect(result.outputFileId).toBeNull()
    expect(result.downloadUrl).toBeNull()
    expect(renderDocumentOutput).not.toHaveBeenCalled()
    expect(uploadFileBuffer).not.toHaveBeenCalled()
    expect(createRecord).toHaveBeenCalledWith(
      'doc_value',
      expect.not.objectContaining({ output_file: expect.anything() }),
      ['id'],
      expect.anything(),
    )
  })

  it('skips persist when persist=false but still renders', async () => {
    const result = await generateDocument(me, { ...input, persist: false })
    expect(result.docValueId).toBeNull()
    expect(result.outputFileId).toBe('file-1')
    expect(result.downloadUrl).toBe('/assets/file-1')
    expect(result.values).toMatchObject({ amount: 42 })
    expect(createRecord).not.toHaveBeenCalled()
    expect(assertMeEntityPermission.mock.calls).toEqual([
      [me, 'opportunity', 'read'],
    ])
  })

  it('rejects when the caller cannot read the source record (owner RLS)', async () => {
    findOneRecord.mockImplementation(async (collection: string, id: string) => {
      if (collection === 'opportunity' && id === 'rec-1') {
        throw new Error('Permission denied: read on opportunity')
      }
      if (collection === 'doc_template') return { id: 'tmpl-1', body: TEMPLATE_BODY }
      throw new Error(`Record not found: ${collection}`)
    })
    await expect(generateDocument(me, input)).rejects.toThrow(
      /Permission denied or record not found/,
    )
  })

  it('rejects unknown templates', async () => {
    findOneRecord.mockImplementation(async (collection: string) => {
      if (collection === 'opportunity') return { id: 'rec-1' }
      if (collection === 'doc_template') {
        throw new Error('Record not found: tmpl-1')
      }
      throw new Error(`Record not found: ${collection}`)
    })
    await expect(generateDocument(me, input)).rejects.toThrow(/Template not found/)
  })
})
