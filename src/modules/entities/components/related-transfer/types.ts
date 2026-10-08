export type TransferRowKind = 'current' | 'pending'

export const LOOKUP_SOURCE_COLUMN_PREFIX = '__lookup:'

export interface LookupSelectOption {
  label: string
  value: unknown
}

export interface LookupHeaderItem {
  token: string
  label: string
  value: unknown
}

export interface TransferRow {
  key: string
  kind: TransferRowKind
  source?: Record<string, unknown>
  target?: Record<string, unknown>
  draft?: Record<string, unknown>
  lookupOptions?: Record<string, LookupSelectOption[]>
}

export interface SourceItemsResult {
  items: Record<string, unknown>[]
  choiceLabels: Map<string, Map<string, string>>
  /** Source primary key -> display label for the source record itself. */
  sourceRecordLabels: Map<string, string>
  /** Source many-to-one field -> related collection. */
  sourceRelationCollections: Map<string, string>
  lookupRows: Map<string, Map<string, Record<string, unknown>>>
  lookupHeaderItems: LookupHeaderItem[]
  /** Non-fatal load issue (e.g. empty parent filter token). */
  warning?: string
}

export interface LookupFilterSplit {
  sourceLinkField: string
  parentFilter: Record<string, unknown> | null
}

export interface LookupPrefilterResult {
  allowedSourceIds: Set<string> | null
  lookupRows: Map<string, Map<string, Record<string, unknown>>>
  headerItems: LookupHeaderItem[]
}

export type TranslateFn = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string

export type SourceDisplayFn = (item: Record<string, unknown>, field: string) => string
export type RowValueFn = (row: TransferRow, field: string) => unknown
export type FormatValueFn = (value: unknown) => string
