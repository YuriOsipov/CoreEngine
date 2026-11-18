/** CI-only stub so crm-bff installs without sibling DocEngine. */

export function generatePdfFromTemplate() {
  return Promise.resolve(Buffer.from('%PDF-1.4 stub'))
}

export function generateHtmlFromTemplate() {
  return Promise.resolve('<!doctype html><html><body>stub</body></html>')
}

export function generateDocumentPdf() {
  return Promise.resolve(Buffer.from('%PDF-1.4 stub'))
}

export function generateDocumentHtml() {
  return Promise.resolve('<!doctype html><html><body>stub</body></html>')
}

export function mergeTemplateAndDocument(template, document) {
  return { blocks: template?.blocks ?? [], fieldSchemas: {}, time: Date.now(), ...document }
}
