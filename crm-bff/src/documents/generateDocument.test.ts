import { describe, expect, it } from 'vitest'
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
  it('throws DOCUMENTS_GENERATE_STUB after validating input', async () => {
    await expect(
      generateDocument({
        collectionName: 'opportunity',
        recordId: 'rec-1',
        templateId: 'tmpl-1',
      }),
    ).rejects.toMatchObject({
      code: DOCUMENTS_GENERATE_STUB_CODE,
      statusCode: 501,
    })
    await expect(
      generateDocument({
        collectionName: 'opportunity',
        recordId: 'rec-1',
        templateId: 'tmpl-1',
      }),
    ).rejects.toBeInstanceOf(DocumentsGenerateStubError)
  })
})
