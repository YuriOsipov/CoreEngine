import createDOMPurify from 'dompurify'

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

type DomPurifyInstance = {
  sanitize: (
    dirty: string,
    cfg?: {
      USE_PROFILES?: { html?: boolean }
      FORBID_TAGS?: string[]
    },
  ) => string
  addHook: (
    entryPoint: string,
    hookFunction: (node: Element) => void,
  ) => void
}

/**
 * Browser builds export a ready instance; Node/vitest may export the factory
 * (needs `window`) or a stub without hooks — never call addHook blindly.
 */
function resolvePurify(): DomPurifyInstance | null {
  const mod = createDOMPurify as unknown as DomPurifyInstance &
    ((window: Window) => DomPurifyInstance)
  if (typeof mod?.sanitize === 'function' && typeof mod?.addHook === 'function') {
    return mod
  }
  if (typeof window !== 'undefined' && typeof mod === 'function') {
    return mod(window)
  }
  return null
}

const purify = resolvePurify()

if (purify) {
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
      node.setAttribute('rel', 'noopener noreferrer')
      if (node.getAttribute('target')) node.setAttribute('target', '_blank')
    }
  })
}

/** Every `v-html` of record / user-authored content must go through this. */
export function sanitizeHtmlContent(value: unknown): string {
  const html = normalizeHtmlContent(value)
  if (!html) return ''
  if (!purify) {
    // Node / vitest without a DOM — never return raw HTML.
    return stripHtmlTags(html)
  }
  return purify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  })
}

export function plainTextFromHtml(value: unknown): string {
  return stripHtmlTags(normalizeHtmlContent(value))
}
