/**
 * Real DocEngine PDF/HTML render (sibling checkout or DOCENGINE_REAL_RENDER=1).
 * Default CI jobs use ci/stubs and skip this file via vitest exclude / gate.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { renderDocumentInWorker } from './renderInWorker.js'

const require = createRequire(import.meta.url)

function resolvedPdfRendererPath(): string {
  try {
    return require.resolve('@docengine/pdf-renderer')
  } catch {
    return ''
  }
}

const pdfRendererPath = resolvedPdfRendererPath()
const isStub = /ci[/\\]stubs[/\\]docengine-pdf-renderer/.test(pdfRendererPath)
const forceReal = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.DOCENGINE_REAL_RENDER || '')
    .trim()
    .toLowerCase(),
)
const runReal = forceReal || (Boolean(pdfRendererPath) && !isStub)

const TEMPLATE_BODY = {
  kind: 'template',
  blocks: [
    {
      id: 'b1',
      type: 'paragraph',
      data: { text: 'CoreEngine DocEngine CI smoke' },
    },
  ],
  fieldSchemas: {},
}

const FIELDS_EXPORT = {
  kind: 'field',
  version: 1,
  time: Date.now(),
  values: {},
}

describe.runIf(runReal)('DocEngine real render (sibling)', () => {
  it('renders a non-stub PDF via the worker', async () => {
    expect(isStub, `expected real @docengine/pdf-renderer, got ${pdfRendererPath}`).toBe(
      false,
    )

    const rendered = await renderDocumentInWorker({
      template: TEMPLATE_BODY,
      document: FIELDS_EXPORT,
      outputFormat: 'pdf',
      title: 'ci-smoke',
    })

    expect(rendered.mimeType).toMatch(/pdf/i)
    expect(rendered.filename).toMatch(/\.pdf$/i)
    expect(rendered.buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-')
    // Stub is literally "%PDF-1.4 stub" (~14 bytes). Real pdfmake output is larger.
    expect(rendered.buffer.byteLength).toBeGreaterThan(200)
    expect(rendered.buffer.toString('utf8')).not.toContain('%PDF-1.4 stub')
  }, 60_000)

  it('renders HTML via the worker', async () => {
    const rendered = await renderDocumentInWorker({
      template: TEMPLATE_BODY,
      document: FIELDS_EXPORT,
      outputFormat: 'html',
      title: 'ci-smoke',
    })

    expect(rendered.mimeType).toMatch(/html/i)
    const html = rendered.buffer.toString('utf8')
    expect(html.toLowerCase()).toContain('html')
    expect(html).not.toContain('<body>stub</body>')
    expect(html).toMatch(/CoreEngine DocEngine CI smoke/)
  }, 60_000)
})

describe.runIf(!runReal)('DocEngine real render (skipped without sibling)', () => {
  it('documents that stub CI skips real PDF coverage', () => {
    expect(isStub || !pdfRendererPath).toBe(true)
  })
})
