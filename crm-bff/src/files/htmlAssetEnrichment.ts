import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const enrichmentDir = dirname(fileURLToPath(import.meta.url))

let cachedDocumentStyles: string | null = null

function loadPreviewDocumentStyles(): string {
  if (cachedDocumentStyles != null) return cachedDocumentStyles
  cachedDocumentStyles = readFileSync(
    join(enrichmentDir, 'previewDocumentStyles.css'),
    'utf8',
  )
  return cachedDocumentStyles
}

const PAGE_CHROME_CSS = `
html { background: #f1f5f9; }
body {
  margin: 0 !important;
  padding: 20px 16px 28px !important;
  background: #f1f5f9 !important;
  min-height: 100vh;
  box-sizing: border-box;
  display: flex !important;
  justify-content: center;
  align-items: flex-start;
}
.preview-document {
  width: 210mm;
  max-width: 100%;
  min-height: 297mm;
  box-sizing: border-box;
  background: #fff;
  color: #000;
  padding: 15mm !important;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  box-shadow: 0 1px 2px rgba(15,23,42,.06), 0 4px 12px rgba(15,23,42,.08);
}
.preview-document .vision-table,
.preview-document .vision-table-block,
.preview-document .document-table {
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
}
.preview-document img {
  max-width: 100%;
  height: auto;
}
@page { size: A4 portrait; margin: 0; }
@media print {
  html, body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
    min-height: 0 !important;
    display: block !important;
  }
  .preview-document {
    width: auto !important;
    min-height: 0 !important;
    border: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    padding: 15mm !important;
  }
}
`

function hasPreviewDocumentRoot(html: string): boolean {
  return /class\s*=\s*["'][^"']*\bpreview-document\b/i.test(html)
}

function hasDocumentStyles(html: string): boolean {
  return (
    /data-crm-preview-html\s*=\s*["']1["']/i.test(html) ||
    /--me-document-font-family/i.test(html)
  )
}

function hasPageChrome(html: string): boolean {
  return /data-crm-page-chrome\s*=\s*["']1["']/i.test(html)
}

function wrapBodyWithPreviewDocument(html: string): string {
  if (!/<body[\s>]/i.test(html)) return html
  return html
    .replace(/<body([^>]*)>/i, '<body$1><div class="preview-document">')
    .replace(/<\/body>/i, '</div></body>')
}

function injectStyle(html: string, styleTag: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${styleTag}</head>`)
  }
  if (/<html([^>]*)>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${styleTag}</head>`)
  }
  return `${styleTag}${html}`
}

/**
 * Ensure served HTML attachments include DocEngine document CSS + A4 page chrome.
 * Older exports were class-only markup (no stylesheet), so Preview/print looked bare.
 */
export function enrichHtmlAssetBuffer(buffer: Buffer, contentType: string): Buffer {
  if (!contentType.toLowerCase().includes('text/html')) return buffer
  let html = buffer.toString('utf8')
  if (!/<html[\s>]/i.test(html) && !/<body[\s>]/i.test(html)) return buffer

  let changed = false

  if (!hasPreviewDocumentRoot(html) && /<body[\s>]/i.test(html)) {
    html = wrapBodyWithPreviewDocument(html)
    changed = true
  }

  if (!hasDocumentStyles(html)) {
    const styles = loadPreviewDocumentStyles()
    html = injectStyle(
      html,
      `<style data-crm-preview-html="1">${styles}</style>`,
    )
    changed = true
  }

  if (!hasPageChrome(html)) {
    html = injectStyle(
      html,
      `<style data-crm-page-chrome="1">${PAGE_CHROME_CSS}</style>`,
    )
    changed = true
  }

  return changed ? Buffer.from(html, 'utf8') : buffer
}
