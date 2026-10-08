import { buildPreviewHtmlDocument, renderDocumentPreview } from '@docengine/editor'

export interface PreviewPageSetup {
  format?: string
  orientation?: string
  margin?: number | number[]
}

export function asPageSetup(value: unknown): PreviewPageSetup {
  if (!value || typeof value !== 'object') return {}
  const record = value as PreviewPageSetup
  return {
    format: typeof record.format === 'string' ? record.format : undefined,
    orientation: typeof record.orientation === 'string' ? record.orientation : undefined,
    margin: record.margin,
  }
}

/** True paper size in mm. Matches the editor preview sheet (not fill-mode +10%). */
export function resolvePageFormatSizeMm(pageSetup: PreviewPageSetup): {
  widthMm: number
  heightMm: number
} {
  const format = String(pageSetup.format ?? 'a4').toLowerCase()
  const portrait =
    format === 'letter'
      ? { widthMm: 215.9, heightMm: 279.4 }
      : { widthMm: 210, heightMm: 297 }
  if (String(pageSetup.orientation ?? 'portrait').toLowerCase() === 'landscape') {
    return { widthMm: portrait.heightMm, heightMm: portrait.widthMm }
  }
  return portrait
}

export function resolvePageMarginsMm(
  pageSetup: PreviewPageSetup,
): [number, number, number, number] {
  const margin = pageSetup.margin
  if (typeof margin === 'number' && Number.isFinite(margin) && margin >= 0) {
    return [margin, margin, margin, margin]
  }
  if (Array.isArray(margin)) {
    const nums = margin.map((value) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null,
    )
    if (
      nums.length >= 4 &&
      nums[0] != null &&
      nums[1] != null &&
      nums[2] != null &&
      nums[3] != null
    ) {
      return [nums[0], nums[1], nums[2], nums[3]]
    }
    if (nums[0] != null) return [nums[0], nums[0], nums[0], nums[0]]
  }
  return [15, 15, 15, 15]
}

function applyPageSheetVars(sheet: HTMLElement, pageSetup: PreviewPageSetup): void {
  const { widthMm, heightMm } = resolvePageFormatSizeMm(pageSetup)
  const [topMm, rightMm, , leftMm] = resolvePageMarginsMm(pageSetup)
  const contentWidthMm = Math.max(40, +(widthMm - leftMm - rightMm).toFixed(2))
  sheet.style.setProperty('--doc-page-width', `${+widthMm.toFixed(2)}mm`)
  sheet.style.setProperty('--doc-page-min-height', `${+heightMm.toFixed(2)}mm`)
  sheet.style.setProperty('--doc-page-margin', `${+topMm.toFixed(2)}mm`)
  sheet.style.setProperty('--doc-page-content-width', `${contentWidthMm}mm`)
}

/**
 * Screen + print page chrome for standalone HTML files (download / /assets Preview).
 * Constrains content to A4 so Chrome print doesn't shrink a wide viewport page.
 */
export function buildStandalonePageChromeCss(pageSetupInput?: unknown): string {
  const pageSetup = asPageSetup(pageSetupInput)
  const { widthMm, heightMm } = resolvePageFormatSizeMm(pageSetup)
  const [topMm, rightMm, bottomMm, leftMm] = resolvePageMarginsMm(pageSetup)
  const format = String(pageSetup.format ?? 'a4').toLowerCase() === 'letter' ? 'letter' : 'A4'
  const orientation =
    String(pageSetup.orientation ?? 'portrait').toLowerCase() === 'landscape'
      ? 'landscape'
      : 'portrait'

  return `
html {
  background: #f1f5f9;
}
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
  width: ${widthMm}mm;
  max-width: 100%;
  min-height: ${heightMm}mm;
  box-sizing: border-box;
  background: #fff;
  color: #000;
  padding: ${topMm}mm ${rightMm}mm ${bottomMm}mm ${leftMm}mm !important;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 4px 12px rgba(15, 23, 42, 0.08),
    0 16px 32px rgba(15, 23, 42, 0.06);
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
@page { size: ${format} ${orientation}; margin: 0; }
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
    max-width: none !important;
    min-height: 0 !important;
    margin: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    padding: ${topMm}mm ${rightMm}mm ${bottomMm}mm ${leftMm}mm !important;
  }
}
`
}

/** Inject A4 page chrome into a standalone HTML document string. */
export function injectStandalonePageChrome(
  html: string,
  pageSetupInput?: unknown,
): string {
  const css = buildStandalonePageChromeCss(pageSetupInput)
  const styleTag = `<style data-crm-page-chrome="1">${css}</style>`
  if (/data-crm-page-chrome\s*=\s*["']1["']/i.test(html)) {
    return html
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${styleTag}</head>`)
  }
  return `${styleTag}${html}`
}

/** Standalone HTML file for download / attachment (styled + A4 page chrome). */
export function buildStandaloneDocumentHtml(
  doc: Record<string, unknown>,
  options?: { title?: string; hideEmptyValues?: boolean },
): string {
  const pageSetup = asPageSetup(doc.pageSetup)
  const html = buildPreviewHtmlDocument(doc, {
    title: options?.title || 'document',
    hideEmptyValues: options?.hideEmptyValues ?? false,
    pageSetup,
  })
  return injectStandalonePageChrome(html, pageSetup)
}

/**
 * Mount an HTML preview using the same page sheet as the editor preview modal:
 * paper size, margins, and the page border.
 */
export function mountDocumentHtmlPreview(
  host: HTMLElement,
  doc: Record<string, unknown>,
  options?: { hideEmptyValues?: boolean },
): HTMLElement {
  host.replaceChildren()

  const wrap = document.createElement('div')
  wrap.className = 'preview-modal__html'

  const sheet = document.createElement('div')
  sheet.className = 'preview-modal__sheet'
  applyPageSheetVars(sheet, asPageSetup(doc.pageSetup))

  const preview = renderDocumentPreview(doc as never, {
    hideEmptyValues: options?.hideEmptyValues ?? false,
  })
  sheet.appendChild(preview)
  wrap.appendChild(sheet)
  host.appendChild(wrap)
  return wrap
}

/** Print the HTML preview in a hidden frame so the app chrome stays off the page. */
export function printDocumentHtmlPreview(
  doc: Record<string, unknown>,
  title: string,
): void {
  const html = buildStandaloneDocumentHtml(doc, {
    title: title || 'document',
  })
  const iframe = document.createElement('iframe')
  iframe.setAttribute(
    'style',
    'position:fixed;width:0;height:0;border:0;visibility:hidden',
  )
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)

  const frameWindow = iframe.contentWindow
  const frameDoc = iframe.contentDocument
  if (!frameWindow || !frameDoc) {
    iframe.remove()
    return
  }

  const removeFrame = (): void => {
    iframe.remove()
  }

  frameDoc.open()
  frameDoc.write(html)
  frameDoc.close()

  frameWindow.addEventListener('afterprint', removeFrame, { once: true })
  window.setTimeout(() => {
    frameWindow.focus()
    frameWindow.print()
    window.setTimeout(removeFrame, 60_000)
  }, 0)
}
