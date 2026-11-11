/**
 * Strip script-capable markup from rich-text (Editor) fields before persistence.
 * The UI sanitises again on render; this keeps REST / GraphQL / flow writes clean.
 */
import DOMPurify from 'isomorphic-dompurify'
import { loadEntityFieldMeta } from './fieldMeta.js'

export function isHtmlFieldInterface(fieldInterface: string): boolean {
  const iface = fieldInterface.toLowerCase()
  return iface.includes('wysiwyg') || iface.includes('rich-text-html')
}

export function sanitizeHtmlValue(value: string): string {
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  })
}

export async function sanitizeHtmlFieldWrites(
  entityApiName: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await loadEntityFieldMeta(entityApiName)
  const next = { ...patch }
  for (const field of fields) {
    if (!isHtmlFieldInterface(field.interface)) continue
    const value = next[field.apiName]
    if (typeof value === 'string' && value) {
      next[field.apiName] = sanitizeHtmlValue(value)
    }
  }
  return next
}
