import { beforeEach, describe, expect, it, vi } from 'vitest'

const assertMeEntityPermission = vi.fn()
vi.mock('../services/rolePermissions.js', () => ({
  assertMeEntityPermission: (...args: unknown[]) => assertMeEntityPermission(...args),
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
    assertMeEntityPermission.mockResolvedValue(me)
  })

  it('throws DOCUMENTS_GENERATE_STUB after validating input and ACL', async () => {
    await expect(generateDocument(me, input)).rejects.toMatchObject({
      code: DOCUMENTS_GENERATE_STUB_CODE,
      statusCode: 501,
    })
    await expect(generateDocument(me, input)).rejects.toBeInstanceOf(
      DocumentsGenerateStubError,
    )
    expect(assertMeEntityPermission.mock.calls.slice(0, 3)).toEqual([
      [me, 'opportunity', 'read'],
      [me, 'doc_template', 'read'],
      [me, 'doc_value', 'create'],
    ])
  })

  it('rejects before the stub when the caller lacks record read', async () => {
    assertMeEntityPermission.mockRejectedValueOnce(
      new Error('Permission denied: read on opportunity'),
    )
    await expect(generateDocument(me, input)).rejects.toThrow(/Permission denied/)
  })
})
