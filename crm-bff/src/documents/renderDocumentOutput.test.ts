import { describe, expect, it } from 'vitest'
import {
  buildFieldsExportFromValues,
  normalizeTemplateExport,
} from './renderDocumentOutput.js'

describe('normalizeTemplateExport', () => {
  it('accepts kind template with blocks', () => {
    const body = {
      kind: 'template',
      blocks: [{ id: '1', type: 'paragraph', data: {} }],
      fieldSchemas: {},
    }
    expect(normalizeTemplateExport(body)).toEqual(body)
  })

  it('rejects missing or non-template body', () => {
    expect(() => normalizeTemplateExport(null)).toThrow(/missing or invalid/)
    expect(() =>
      normalizeTemplateExport({ kind: 'document', blocks: [] }),
    ).toThrow(/kind "template"/)
    expect(() =>
      normalizeTemplateExport({ kind: 'template' }),
    ).toThrow(/missing blocks/)
  })
})

describe('buildFieldsExportFromValues', () => {
  it('wraps flat values as FieldsExport kind field', () => {
    const exported = buildFieldsExportFromValues({ amount: 10 })
    expect(exported.kind).toBe('field')
    expect(exported.values).toEqual({ amount: 10 })
  })
})
