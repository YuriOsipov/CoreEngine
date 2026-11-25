import {
  TYPES,
  type IDimension,
  type IIndicator,
  type PivotTableConstructorOptions,
} from '@visactor/vtable'
import type {
  ReportAggregate,
  ReportDateGrain,
  ReportPivotDimension,
  ReportPivotSettings,
  ReportPivotValue,
  ReportSortDirection,
} from './reportSettings'
import {
  normalizePivotSort,
  reportColumnWidthKey,
  reportFieldDisplayLabel,
} from './reportSettings'
import { formatReportDateGrain } from './reportDateGrain'
import { formatReportAggregateValue } from './reportCellDisplay'
import { orderedRowLabelsByTotal } from './reportRowTotalSort'
import {
  formatLocalizedDate,
  formatLocalizedDateTime,
  toDate,
} from '@/core/dateFormatting'
import type { NumberDisplayOptions } from '@/modules/entities/utils/recordDisplay'
import { getPathValue } from '@/modules/entities/utils/recordDisplay'

export const COUNT_FIELD = '__crmRecordCount'
export const ALL_ROWS_FIELD = '__crmAllRows'
export const CRM_RECORD_ID_FIELD = '__crmRecordId'

const CRM_FONT_FAMILY = 'Inter, system-ui, sans-serif'

function readCssToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** VisActor canvas theme from live `--app-*` / OpenVue tokens (light + dark). */
function buildCrmVTableTheme(): TYPES.ITableThemeDefine {
  const bodyBg = readCssToken('--app-panel', '#ffffff')
  const headerBg = readCssToken('--app-canvas', '#f1f5f9')
  const rowHeaderBg = readCssToken('--app-canvas', '#f8fafc')
  const borderColor = readCssToken('--app-border', '#e2e8f0')
  const primaryText = readCssToken('--app-text', '#1e293b')
  const secondaryText = readCssToken('--app-text-muted', '#334155')
  const hoverBg = readCssToken('--app-hover', 'rgba(100, 116, 139, 0.10)')
  const primaryColor = readCssToken('--p-primary-color', '#64748b')
  const scrollRail = readCssToken('--app-canvas', '#f8fafc')
  const scrollSlider = readCssToken('--p-surface-400', '#cbd5e1')

  return {
    underlayBackgroundColor: bodyBg,
    defaultStyle: {
      fontFamily: CRM_FONT_FAMILY,
      fontSize: 12,
      color: secondaryText,
      bgColor: bodyBg,
      borderColor,
      borderLineWidth: 1,
      padding: [8, 10, 8, 10],
      textBaseline: 'middle',
    },
    headerStyle: {
      fontFamily: CRM_FONT_FAMILY,
      fontSize: 12,
      fontWeight: 700,
      color: primaryText,
      bgColor: headerBg,
      borderColor,
      borderLineWidth: 1,
      padding: [8, 10, 8, 10],
      textBaseline: 'middle',
    },
    rowHeaderStyle: {
      fontFamily: CRM_FONT_FAMILY,
      fontSize: 12,
      fontWeight: 600,
      color: secondaryText,
      bgColor: rowHeaderBg,
      borderColor,
      borderLineWidth: 1,
      padding: [8, 10, 8, 10],
      textBaseline: 'middle',
    },
    cornerHeaderStyle: {
      fontFamily: CRM_FONT_FAMILY,
      fontSize: 12,
      fontWeight: 700,
      color: primaryText,
      bgColor: headerBg,
      borderColor,
      borderLineWidth: 1,
      padding: [8, 10, 8, 10],
      textBaseline: 'middle',
    },
    bodyStyle: {
      fontFamily: CRM_FONT_FAMILY,
      fontSize: 12,
      color: secondaryText,
      bgColor: bodyBg,
      borderColor,
      borderLineWidth: 1,
      padding: [8, 10, 8, 10],
      textAlign: 'right',
      textBaseline: 'middle',
      cursor: 'pointer',
    },
    bottomFrozenStyle: {
      fontFamily: CRM_FONT_FAMILY,
      fontSize: 12,
      fontWeight: 700,
      color: primaryText,
      bgColor: rowHeaderBg,
      borderColor,
      borderLineWidth: 1,
      padding: [8, 10, 8, 10],
      textAlign: 'right',
    },
    frameStyle: {
      borderColor,
      borderLineWidth: 1,
      cornerRadius: 8,
    },
    scrollStyle: {
      scrollRailColor: scrollRail,
      scrollSliderColor: scrollSlider,
      scrollSliderCornerRadius: 6,
      width: 8,
      visible: 'scrolling',
      hoverOn: true,
    },
    selectionStyle: {
      cellBorderColor: primaryColor,
      cellBorderLineWidth: 2,
      cellBgColor: hoverBg,
      inlineRowBgColor: hoverBg,
      inlineColumnBgColor: hoverBg,
      selectionFillMode: 'replace',
    },
    tooltipStyle: {
      fontFamily: CRM_FONT_FAMILY,
      fontSize: 12,
      color: secondaryText,
      bgColor: bodyBg,
      padding: [8, 10],
      maxWidth: 320,
    },
  }
}

interface VTableFieldBinding {
  sourceField: string
  vtableField: string
  title: string
  /** Stable key for persisted columnWidths. */
  widthKey: string
  sort?: ReportSortDirection
  dateGrain?: ReportDateGrain | null
}

/** Default body/indicator column width (px) — short by design. */
export const REPORT_DEFAULT_COL_WIDTH = 112
/** Default row-header column width (px). */
export const REPORT_DEFAULT_ROW_HEADER_WIDTH = 128
/** Allow users to shrink columns down to this width when resizing. */
export const REPORT_MIN_COL_WIDTH = 48

export interface ReportVTableLabels {
  allRecords: string
  average: string
  count: string
  emptyValue: string
  max: string
  min: string
  records: string
  sum: string
  total: string
}

const DEFAULT_REPORT_VTABLE_LABELS: ReportVTableLabels = {
  allRecords: 'All records',
  average: 'Average',
  count: 'Count',
  emptyValue: '(empty)',
  max: 'Max',
  min: 'Min',
  records: 'Records',
  sum: 'Sum',
  total: 'Total',
}

export function buildReportVTableOptions(
  rows: Record<string, unknown>[],
  pivot: ReportPivotSettings,
  labels: ReportVTableLabels = DEFAULT_REPORT_VTABLE_LABELS,
  valueDisplayByField: Record<string, NumberDisplayOptions | null | undefined> = {},
  columnWidths: Record<string, number> = {},
): PivotTableConstructorOptions {
  const rowBindings = (pivot.rows ?? []).map((dimension, index) =>
    dimensionBinding(dimension, 'row', index),
  )
  const columnBindings = (pivot.columns ?? []).map((dimension, index) =>
    dimensionBinding(dimension, 'column', index),
  )
  const values = normalizedValues(pivot.values)
  const valueBindings = values.map((value, index) =>
    valueBinding(value, index, labels),
  )
  const effectiveRows = rowBindings.length > 0
    ? rowBindings
    : [{
        sourceField: ALL_ROWS_FIELD,
        vtableField: ALL_ROWS_FIELD,
        title: labels.records,
        widthKey: reportColumnWidthKey('row', ALL_ROWS_FIELD),
        sort: 'asc' as ReportSortDirection,
      }]

  const sortRowsByTotal = pivot.sortRowsByTotal === 'asc' || pivot.sortRowsByTotal === 'desc'
    ? pivot.sortRowsByTotal
    : null
  const primaryValue = values[0]
  const primaryIndicator = valueBindings[0]?.vtableField
  const rowSortBindings = effectiveRows.filter(
    (binding) => binding.sourceField !== ALL_ROWS_FIELD,
  )
  const flattenedRecords = rows.map((row) =>
    flattenReportRow(
      row,
      [
        ...effectiveRows,
        ...columnBindings,
        ...valueBindings,
      ],
      labels,
    ),
  )
  const columnSortRules = columnBindings.map((binding) => ({
    sortField: binding.vtableField,
    sortType: binding.sort === 'desc' ? TYPES.SortType.DESC : TYPES.SortType.ASC,
  }))
  // Prefer an explicit sortBy order from row totals — VTable sortByIndicator + Total
  // query is unreliable across hierarchy modes.
  const totalSortBy = sortRowsByTotal && primaryIndicator && rowSortBindings[0]
    ? orderedRowLabelsByTotal(
        flattenedRecords,
        rowSortBindings[0].vtableField,
        primaryValue,
        primaryIndicator,
        sortRowsByTotal,
        labels.emptyValue,
      )
    : null
  const sortRules = totalSortBy && rowSortBindings[0]
    ? [
        {
          sortField: rowSortBindings[0].vtableField,
          sortBy: totalSortBy,
          sortType: TYPES.SortType.ASC,
        },
        ...rowSortBindings.slice(1).map((binding) => ({
          sortField: binding.vtableField,
          sortType: binding.sort === 'desc' ? TYPES.SortType.DESC : TYPES.SortType.ASC,
        })),
        ...columnSortRules,
      ]
    : [
        ...rowSortBindings.map((binding) => ({
          sortField: binding.vtableField,
          sortType: binding.sort === 'desc' ? TYPES.SortType.DESC : TYPES.SortType.ASC,
        })),
        ...columnSortRules,
      ]

  return {
    records: flattenedRecords,
    rows: effectiveRows.map((binding) =>
      toRowDimension(binding, resolveWidth(columnWidths, binding.widthKey, REPORT_DEFAULT_ROW_HEADER_WIDTH)),
    ),
    columns: columnBindings.map((binding) =>
      toColumnDimension(
        binding,
        resolveWidth(columnWidths, binding.widthKey, REPORT_DEFAULT_COL_WIDTH),
      ),
    ),
    indicators: valueBindings.map((binding, index) =>
      toIndicator(
        values[index],
        binding,
        valueDisplayByField[values[index].field],
        resolveWidth(columnWidths, binding.widthKey, REPORT_DEFAULT_COL_WIDTH),
      ),
    ),
    indicatorsAsCol: true,
    hideIndicatorName: valueBindings.length === 1,
    theme: buildCrmVTableTheme(),
    // Cell-only selection — avoid full row/column green washes that look like empty gaps.
    select: {
      highlightMode: 'cell',
    },
    hover: {
      highlightMode: 'cell',
    },
    rowHierarchyType: rowBindings.length > 0 ? 'tree' : 'grid',
    rowExpandLevel: Math.max(1, effectiveRows.length),
    rowHierarchyIndent: 16,
    rowHierarchyTextStartAlignment: true,
    columnHierarchyType: 'grid',
    widthMode: 'standard',
    heightMode: 'standard',
    defaultColWidth: REPORT_DEFAULT_COL_WIDTH,
    columnResizeMode: 'header',
    // Resize only the dragged column — not indicator groups / siblings.
    columnResizeType: 'column',
    columnHeaderTitle: columnBindings.length > 0
      ? {
          title: titleList(columnBindings),
          headerType: 'text',
        }
      : undefined,
    indicatorTitle: titleList(valueBindings),
    dataConfig: {
      sortRules,
      aggregationRules: valueBindings.map((binding, index) => ({
        indicatorKey: binding.vtableField,
        field: values[index].aggregate === 'count'
          ? COUNT_FIELD
          : binding.vtableField,
        aggregationType: aggregateType(values[index].aggregate),
        formatFun: (value: number | string) =>
          formatReportAggregateValue(
            value,
            values[index].aggregate,
            valueDisplayByField[values[index].field],
          ),
      })),
      totals: {
        row: {
          showGrandTotals: true,
          showSubTotals: false,
          grandTotalLabel: labels.total,
        },
        column: {
          showGrandTotals: columnBindings.length > 0,
          showSubTotals: false,
          grandTotalLabel: labels.total,
        },
      },
    },
    corner: {
      titleOnDimension: 'row',
      forceShowHeader: true,
    },
  }
}

export function dimensionDisplayValue(
  value: unknown,
  emptyLabel = DEFAULT_REPORT_VTABLE_LABELS.emptyValue,
  dateGrain?: ReportDateGrain | null,
): string {
  return dimensionValueWithGrain(
    value,
    dateGrain,
    { ...DEFAULT_REPORT_VTABLE_LABELS, emptyValue: emptyLabel },
  )
}

export function extractRecordIdsFromCellRecords(
  raw: unknown,
): Array<string | number> {
  const records = normalizeCellRecords(raw)
  const ids: Array<string | number> = []
  for (const record of records) {
    const id = record[CRM_RECORD_ID_FIELD] ?? record.id
    if (id === null || id === undefined || id === '') continue
    if (typeof id === 'string' || typeof id === 'number') {
      ids.push(id)
    }
  }
  return ids
}

export function extractHeaderPathValues(
  paths: Array<{ value?: unknown; indicatorKey?: unknown; dimensionKey?: unknown }> | undefined,
): string[] {
  if (!Array.isArray(paths)) return []
  return paths
    .filter((path) => !path?.indicatorKey)
    .map((path) => String(path?.value ?? ''))
    .filter((value) => value.length > 0)
}

function normalizeCellRecords(raw: unknown): Record<string, unknown>[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object',
    )
  }
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if (Array.isArray(record.records)) {
      return record.records.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object',
      )
    }
    return [record]
  }
  return []
}

function flattenReportRow(
  row: Record<string, unknown>,
  bindings: VTableFieldBinding[],
  labels: ReportVTableLabels,
): Record<string, unknown> {
  const flattened: Record<string, unknown> = {
    [COUNT_FIELD]: 1,
    [ALL_ROWS_FIELD]: labels.allRecords,
    [CRM_RECORD_ID_FIELD]: row.id ?? null,
  }

  for (const binding of bindings) {
    if (binding.sourceField === ALL_ROWS_FIELD) {
      flattened[binding.vtableField] = labels.allRecords
      continue
    }

    const value = getPathValue(row, binding.sourceField)
    if (binding.vtableField.startsWith('value_')) {
      flattened[binding.vtableField] = numericValue(value)
      continue
    }
    flattened[binding.vtableField] = dimensionValueWithGrain(
      value,
      binding.dateGrain,
      labels,
    )
  }

  return flattened
}

function normalizedValues(values: ReportPivotValue[]): ReportPivotValue[] {
  return values.length > 0
    ? values
    : [{ field: COUNT_FIELD, aggregate: 'count' }]
}

function dimensionBinding(
  dimension: ReportPivotDimension | string,
  kind: 'row' | 'column',
  index: number,
): VTableFieldBinding {
  const field = typeof dimension === 'string' ? dimension : dimension.field
  const sort = typeof dimension === 'string'
    ? 'asc'
    : normalizePivotSort(dimension.sort)
  const dateGrain = typeof dimension === 'string'
    ? null
    : (dimension.dateGrain ?? null)
  const widthKind = kind === 'row' ? 'row' : 'col'
  return {
    sourceField: field,
    vtableField: `${kind}_${index}_${safeFieldKey(field)}`,
    title: reportFieldDisplayLabel(field),
    widthKey: reportColumnWidthKey(widthKind, field),
    sort,
    dateGrain,
  }
}

function valueBinding(
  value: ReportPivotValue,
  index: number,
  labels = DEFAULT_REPORT_VTABLE_LABELS,
): VTableFieldBinding {
  const leaf = value.field === '*' ? '' : reportFieldDisplayLabel(value.field)
  return {
    sourceField: value.field,
    vtableField: `value_${index}_${safeFieldKey(value.field)}_${value.aggregate}`,
    title: value.aggregate === 'count'
      ? `${labels.count} ${leaf}`.trim()
      : `${aggregateTitle(value.aggregate, labels)} ${leaf}`.trim(),
    widthKey: reportColumnWidthKey('value', value.field, value.aggregate),
  }
}

function resolveWidth(
  widths: Record<string, number>,
  widthKey: string,
  fallback: number,
): number {
  const stored = widths[widthKey]
  if (typeof stored === 'number' && Number.isFinite(stored) && stored >= 40) {
    return Math.round(stored)
  }
  return fallback
}

function toRowDimension(binding: VTableFieldBinding, width: number): IDimension {
  return {
    dimensionKey: binding.vtableField,
    title: binding.title,
    sort: true,
    headerStyle: {
      textStick: true,
    },
    width,
    minWidth: REPORT_MIN_COL_WIDTH,
  }
}

function toColumnDimension(binding: VTableFieldBinding, width: number): IDimension {
  return {
    dimensionKey: binding.vtableField,
    title: binding.title,
    sort: true,
    width,
    minWidth: REPORT_MIN_COL_WIDTH,
  }
}

function toIndicator(
  value: ReportPivotValue,
  binding: VTableFieldBinding,
  numberDisplay?: NumberDisplayOptions | null,
  width: number = REPORT_DEFAULT_COL_WIDTH,
): IIndicator {
  return {
    indicatorKey: binding.vtableField,
    title: binding.title,
    cellType: 'text',
    width,
    minWidth: REPORT_MIN_COL_WIDTH,
    style: {
      textAlign: 'right',
      textBaseline: 'middle',
      cursor: 'pointer',
    },
    headerStyle: {
      textAlign: 'right',
      textBaseline: 'middle',
    },
    format: (cellValue: unknown) =>
      formatReportAggregateValue(cellValue, value.aggregate, numberDisplay),
  } as IIndicator
}

/** Map VTable dimension/indicator keys back to persisted width keys. */
export function buildVTableWidthKeyMap(
  pivot: ReportPivotSettings,
): Map<string, string> {
  const map = new Map<string, string>()
  const rows = (pivot.rows ?? []).map((dimension, index) =>
    dimensionBinding(dimension, 'row', index),
  )
  const columns = (pivot.columns ?? []).map((dimension, index) =>
    dimensionBinding(dimension, 'column', index),
  )
  const values = normalizedValues(pivot.values)
  const valueBindings = values.map((value, index) =>
    valueBinding(value, index),
  )
  for (const binding of [...rows, ...columns, ...valueBindings]) {
    map.set(binding.vtableField, binding.widthKey)
  }
  if (rows.length === 0) {
    map.set(ALL_ROWS_FIELD, reportColumnWidthKey('row', ALL_ROWS_FIELD))
  }
  return map
}

function aggregateType(aggregate: ReportAggregate): TYPES.AggregationType {
  if (aggregate === 'sum') return TYPES.AggregationType.SUM
  if (aggregate === 'avg') return TYPES.AggregationType.AVG
  if (aggregate === 'min') return TYPES.AggregationType.MIN
  if (aggregate === 'max') return TYPES.AggregationType.MAX
  return TYPES.AggregationType.COUNT
}

function aggregateTitle(
  aggregate: ReportAggregate,
  labels: ReportVTableLabels,
): string {
  if (aggregate === 'avg') return labels.average
  if (aggregate === 'sum') return labels.sum
  if (aggregate === 'min') return labels.min
  if (aggregate === 'max') return labels.max
  return labels.count
}

function titleList(bindings: VTableFieldBinding[]): string {
  return bindings.map((binding) => binding.title).join(' / ')
}

function dimensionValueWithGrain(
  value: unknown,
  dateGrain: ReportDateGrain | null | undefined,
  labels: ReportVTableLabels,
): string {
  if (dateGrain) {
    if (value === null || value === undefined || value === '') return labels.emptyValue
    const bucket = formatReportDateGrain(value, dateGrain)
    return bucket ?? labels.emptyValue
  }
  return dimensionValue(value, labels)
}

function dimensionValue(value: unknown, labels: ReportVTableLabels): string {
  if (value === null || value === undefined || value === '') return labels.emptyValue
  if (typeof value === 'object') {
    if (value instanceof Date) {
      return formatLocalizedDateTime(value, { includeSeconds: false }) || labels.emptyValue
    }
    const record = value as Record<string, unknown>
    if (record.__crmValueType === 'm2o' && record.label !== undefined && record.label !== null) {
      return String(record.label)
    }
    return String(record.name ?? record.title ?? record.label ?? record.id ?? JSON.stringify(record))
  }
  if (typeof value === 'string') {
    const formatted = formatDimensionDateString(value)
    if (formatted !== null) return formatted
  }
  return String(value)
}

/** Format ISO date/datetime with org Setup locale; leave non-dates untouched. */
function formatDimensionDateString(value: string): string | null {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null
  if (!toDate(trimmed)) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return formatLocalizedDate(trimmed) || null
  }
  // Datetime / timestamp (with or without time zone).
  if (
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed)
  ) {
    return formatLocalizedDateTime(trimmed, { includeSeconds: false }) || null
  }
  return null
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function safeFieldKey(field: string): string {
  return field
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'field'
}
