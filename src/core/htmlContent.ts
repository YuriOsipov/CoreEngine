import DOMPurify from 'dompurify'

export function isHtmlEditorComponent(component?: string | null): boolean {
  return component === 'Editor'
}

export function normalizeHtmlContent(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
    node.setAttribute('rel', 'noopener noreferrer')
    if (node.getAttribute('target')) node.setAttribute('target', '_blank')
  }
})

/** Every `v-html` of record / user-authored content must go through this. */
export function sanitizeHtmlContent(value: unknown): string {
  const html = normalizeHtmlContent(value)
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  })
}

export function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function plainTextFromHtml(value: unknown): string {
  return stripHtmlTags(normalizeHtmlContent(value))
}
