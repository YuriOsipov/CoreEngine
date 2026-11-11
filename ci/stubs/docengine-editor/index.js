/** CI-only stub so Vue production build can run without sibling DocEngine. */

export function createEditor() {
  return {
    ready: Promise.resolve(),
    destroy() {},
    async exportTemplate() {
      return {}
    },
    async exportFields() {
      return {}
    },
    async exportDoc() {
      return {}
    },
    validate() {
      return { ok: true, errors: [] }
    },
    async exportPdf() {},
    async preview() {},
    getFieldMapping() {
      return null
    },
    setFieldMapping() {},
  }
}

export function registerField() {}

export function createFieldFormModal() {
  return {
    open() {},
    close() {},
    destroy() {},
  }
}

export function generateDocumentPdfBlob() {
  return Promise.resolve(new Blob())
}

export function buildTemplateExport() {
  return {}
}

export function normalizeFieldMappingSpec(input) {
  return input ?? {}
}

export function applyFieldMapping(doc, _mapping) {
  return doc
}

export function buildMappingResultFromRules() {
  return {}
}

export function getTableMappingSourcePath() {
  return ''
}

export function isFieldMappingSpec(value) {
  return Boolean(value && typeof value === 'object')
}

export function isTableMappingObject(value) {
  return Boolean(value && typeof value === 'object')
}

export function parseMappingResultToRules() {
  return []
}

export function toAbsoluteColumnPath(path) {
  return String(path || '')
}

export function applyDocumentValues(doc) {
  return doc
}

export function isDocExport(value) {
  return Boolean(value && typeof value === 'object')
}

export function isSectionInstanceArray(value) {
  return Array.isArray(value)
}

export function materializeRepeatableSectionInstances(doc) {
  return doc
}

export function normalizeDocumentValues(values) {
  return values ?? {}
}

export function stripValuesFromBlocks(doc) {
  return doc
}

export function buildPreviewHtmlStylesheet() {
  return ''
}

export function buildPreviewHtmlDocument() {
  return '<!doctype html><html><body></body></html>'
}

export function renderDocumentPreview() {
  return { html: '' }
}
