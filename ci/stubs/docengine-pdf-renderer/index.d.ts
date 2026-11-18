export function generatePdfFromTemplate(input?: unknown): Promise<Buffer>
export function generateHtmlFromTemplate(input?: unknown): Promise<string>
export function generateDocumentPdf(doc?: unknown, options?: unknown): Promise<Buffer>
export function generateDocumentHtml(doc?: unknown, options?: unknown): Promise<string>
export function mergeTemplateAndDocument(
  template?: unknown,
  document?: unknown,
): Record<string, unknown>
