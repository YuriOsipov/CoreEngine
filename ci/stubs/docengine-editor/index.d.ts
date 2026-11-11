/** CI-only stub types for `@docengine/editor`. */

export function createEditor(options?: unknown): {
  ready: Promise<void>
  destroy(): void
  exportTemplate(): Promise<Record<string, unknown>>
  exportFields(options?: unknown): Promise<Record<string, unknown>>
  exportDoc(): Promise<Record<string, unknown>>
  validate(): { ok: boolean; errors: unknown[] }
  exportPdf(options?: unknown): Promise<void>
  preview(options?: unknown): Promise<void>
  getFieldMapping(): unknown
  setFieldMapping(spec: unknown): void
}

export function registerField(...args: unknown[]): void
export function createFieldFormModal(...args: unknown[]): {
  open(...args: unknown[]): void
  close(): void
  destroy(): void
}
export function generateDocumentPdfBlob(...args: unknown[]): Promise<Blob>
export function buildTemplateExport(...args: unknown[]): Record<string, unknown>
export function normalizeFieldMappingSpec(input?: unknown): Record<string, unknown>
export function applyFieldMapping(doc: unknown, mapping?: unknown): unknown
export function buildMappingResultFromRules(...args: unknown[]): Record<string, unknown>
export function getTableMappingSourcePath(...args: unknown[]): string
export function isFieldMappingSpec(value: unknown): boolean
export function isTableMappingObject(value: unknown): boolean
export function parseMappingResultToRules(...args: unknown[]): unknown[]
export function toAbsoluteColumnPath(path: unknown): string
export function applyDocumentValues(doc: unknown, ...args: unknown[]): unknown
export function isDocExport(value: unknown): boolean
export function isSectionInstanceArray(value: unknown): boolean
export function materializeRepeatableSectionInstances(doc: unknown): unknown
export function normalizeDocumentValues(values?: unknown): unknown
export function stripValuesFromBlocks(doc: unknown): unknown
export function buildPreviewHtmlStylesheet(...args: unknown[]): string
export function buildPreviewHtmlDocument(...args: unknown[]): string
export function renderDocumentPreview(...args: unknown[]): { html: string }
