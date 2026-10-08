export function isHtmlEditorComponent(component?: string | null): boolean {
  return component === 'Editor'
}

export function normalizeHtmlContent(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
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
