import { buildPreviewHtmlStylesheet } from '@docengine/editor'
import { injectStandalonePageChrome } from '@/modules/documents/services/docHtmlPreview'

/**
 * Prepare attached HTML for FilePreview / browser Preview so it matches DocEngine.
 * Legacy exports omitted stylesheet, `.preview-document` root, and A4 page chrome.
 */
export function prepareHtmlAttachmentSrcdoc(html: string): string {
  let documentHtml = String(html || '').trim()
  if (!documentHtml) return documentHtml

  if (!/<html[\s>]/i.test(documentHtml)) {
    documentHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>${documentHtml}</body></html>`
  }

  if (!/<head[\s>]/i.test(documentHtml)) {
    documentHtml = documentHtml.replace(
      /<html([^>]*)>/i,
      '<html$1><head><meta charset="utf-8"/></head>',
    )
  }

  if (!hasPreviewDocumentRoot(documentHtml)) {
    documentHtml = wrapBodyWithPreviewDocument(documentHtml)
  }

  if (!hasStandalonePreviewStyles(documentHtml)) {
    const styles = buildPreviewHtmlStylesheet({})
    documentHtml = documentHtml.replace(
      /<\/head>/i,
      `<style data-crm-preview-html="1">${styles}</style></head>`,
    )
  }

  return injectStandalonePageChrome(documentHtml)
}

function hasPreviewDocumentRoot(html: string): boolean {
  return /class\s*=\s*["'][^"']*\bpreview-document\b/i.test(html)
}

function hasStandalonePreviewStyles(html: string): boolean {
  return (
    /data-crm-preview-html\s*=\s*["']1["']/i.test(html) ||
    /--me-document-font-family/i.test(html) ||
    /\.vision-table\s*\{/.test(html)
  )
}

function wrapBodyWithPreviewDocument(html: string): string {
  if (!/<body[\s>]/i.test(html)) {
    return html
  }
  return html
    .replace(/<body([^>]*)>/i, '<body$1><div class="preview-document">')
    .replace(/<\/body>/i, '</div></body>')
}
