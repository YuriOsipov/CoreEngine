/**
 * Phase 2 — server DocEngine render (PDF/HTML) via @docengine/pdf-renderer.
 * Render runs in a worker_threads Worker so timeouts hard-kill via terminate().
 * Requires @docengine/pdf-renderer (published @docengine/* or sibling ../docEngine).
 */
import {
  assertRenderOutputSize,
  withRenderSlot,
} from './renderLimits.js'
import { renderDocumentInWorker } from './renderInWorker.js'

export type RenderDocumentOutputFormat = 'pdf' | 'html'

export interface RenderDocumentOutputInput {
  templateBody: unknown
  values: Record<string, unknown>
  outputFormat: RenderDocumentOutputFormat
  title?: string | null
}

export interface RenderDocumentOutputResult {
  buffer: Buffer
  mimeType: string
  filename: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Normalize template.body into a DocEngine TemplateExport. */
export function normalizeTemplateExport(body: unknown): Record<string, unknown> {
  const record = asRecord(body)
  if (!record) {
    throw new Error(
      'Template body is missing or invalid; cannot render document output',
    )
  }
  if (String(record.kind || '').trim() !== 'template') {
    throw new Error(
      'Template body must be a DocEngine template export (kind "template")',
    )
  }
  if (!Array.isArray(record.blocks)) {
    throw new Error('Template body is missing blocks; cannot render document output')
  }
  return record
}

/** Build FieldsExport for mergeTemplateAndDocument (flat values map). */
export function buildFieldsExportFromValues(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return {
    kind: 'field',
    version: 1,
    time: Date.now(),
    values,
  }
}

export async function renderDocumentOutput(
  input: RenderDocumentOutputInput,
): Promise<RenderDocumentOutputResult> {
  return withRenderSlot(async () => {
    const template = normalizeTemplateExport(input.templateBody)
    const document = buildFieldsExportFromValues(input.values)
    const rendered = await renderDocumentInWorker({
      template,
      document,
      outputFormat: input.outputFormat,
      title: input.title,
    })
    assertRenderOutputSize(rendered.buffer)
    return rendered
  })
}
