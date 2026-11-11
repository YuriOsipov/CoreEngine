import { beforeEach, describe, expect, it, vi } from 'vitest'

const assertMeEntityPermission = vi.fn()
const findOneRecord = vi.fn()
vi.mock('../services/rolePermissions.js', () => ({
  assertMeEntityPermission: (...args: unknown[]) => assertMeEntityPermission(...args),
}))
vi.mock('../adapters/records/facade.js', () => ({
  findOneRecord: (...args: unknown[]) => findOneRecord(...args),
}))

import {
  DOCUMENTS_GENERATE_STUB_CODE,
  DocumentsGenerateStubError,
  generateDocument,
  parseGenerateDocumentInput,
} from './generateDocument.js'

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

describe('generateDocument (Phase 0 stub)', () => {
  const me = { id: 'u1' } as never
  const input = {
    collectionName: 'opportunity',
    recordId: 'rec-1',
    templateId: 'tmpl-1',
  }

  beforeEach(() => {
    assertMeEntityPermission.mockReset()
    findOneRecord.mockReset()
    assertMeEntityPermission.mockResolvedValue(me)
    findOneRecord.mockResolvedValue({ id: 'tmpl-1' })
  })

  it('throws DOCUMENTS_GENERATE_STUB after source ACL + template existence', async () => {
    await expect(generateDocument(me, input)).rejects.toMatchObject({
      code: DOCUMENTS_GENERATE_STUB_CODE,
      statusCode: 501,
    })
    await expect(generateDocument(me, input)).rejects.toBeInstanceOf(
      DocumentsGenerateStubError,
    )
    expect(assertMeEntityPermission.mock.calls.slice(0, 2)).toEqual([
      [me, 'opportunity', 'read'],
      [me, 'opportunity', 'update'],
    ])
    expect(findOneRecord).toHaveBeenCalledWith('doc_template', 'tmpl-1', ['id'])
  })

  it('skips update when persist=false', async () => {
    await expect(
      generateDocument(me, { ...input, persist: false }),
    ).rejects.toBeInstanceOf(DocumentsGenerateStubError)
    expect(assertMeEntityPermission.mock.calls).toEqual([[me, 'opportunity', 'read']])
  })

  it('rejects before the stub when the caller lacks record read', async () => {
    assertMeEntityPermission.mockRejectedValueOnce(
      new Error('Permission denied: read on opportunity'),
    )
    await expect(generateDocument(me, input)).rejects.toThrow(/Permission denied/)
  })

  it('rejects unknown templates', async () => {
    findOneRecord.mockRejectedValueOnce(new Error('Record not found: tmpl-1'))
    await expect(generateDocument(me, input)).rejects.toThrow(/Template not found/)
  })
})
