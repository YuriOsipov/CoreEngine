/** CI-only stub types for `@docengine/editor`. */

export function createEditor(options?: unknown): {
  ready: Promise<void>
  destroy(): void
  load(data?: unknown): Promise<void>
  setDesignMode(enabled?: unknown): Promise<void> | void
  exportTemplate(): Promise<Record<string, unknown>>
  exportFields(options?: unknown): Promise<Record<string, unknown>>
  exportDoc(): Promise<Record<string, unknown>>
  validate(): { valid: boolean; missing: Array<{ fieldId: string; label: string }> }
  exportPdf(options?: unknown): Promise<void>
  preview(options?: unknown): Promise<void>
  getFieldMapping(): unknown
  setFieldMapping(spec: unknown): void
  openFieldMapping(options?: unknown): Promise<unknown>
}

export function registerField(...args: unknown[]): void
export function createFieldFormModal(...args: unknown[]): {
  open(...args: unknown[]): void
  close(): void
  destroy(): void
}
export function generateDocumentPdfBlob(...args: unknown[]): Promise<Blob>
export function buildTemplateExport(...args: unknown[]): Record<string, unknown>
export function normalizeFieldMappingSpec(input?: unknown): {
  rules?: unknown[]
  [key: string]: unknown
}
export function applyFieldMapping(...args: unknown[]): {
  fieldsExport?: Record<string, unknown>
  [key: string]: unknown
}
export function buildMappingResultFromRules(...args: unknown[]): Record<string, unknown>
export function getTableMappingSourcePath(...args: unknown[]): string
export function isFieldMappingSpec(value: unknown): boolean
export function isTableMappingObject(value: unknown): boolean
export function parseMappingResultToRules(...args: unknown[]): unknown[]
export function toAbsoluteColumnPath(...args: unknown[]): string
export function applyDocumentValues(...args: unknown[]): {
  blocks: unknown[]
  fieldSchemas: Record<string, unknown>
}
export function isDocExport(value: unknown): boolean
export function isSectionInstanceArray(value: unknown): value is unknown[]
export function materializeRepeatableSectionInstances(...args: unknown[]): {
  blocks: unknown[]
  fieldSchemas: Record<string, unknown>
}
export function normalizeDocumentValues(...args: unknown[]): Record<string, unknown>
export function stripValuesFromBlocks(...args: unknown[]): unknown[]
export function buildPreviewHtmlStylesheet(...args: unknown[]): string
export function buildPreviewHtmlDocument(...args: unknown[]): string
export function renderDocumentPreview(...args: unknown[]): HTMLElement
