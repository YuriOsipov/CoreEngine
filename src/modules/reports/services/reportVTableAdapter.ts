import {
  TYPES,
  type IDimension,
  type IIndicator,
  type PivotTableConstructorOptions,
} from '@visactor/vtable'
import type {
  ReportAggregate,
  ReportPivotSettings,
  ReportPivotValue,
} from './reportSettings'
import { getPathValue } from '@/modules/entities/utils/recordDisplay'

const COUNT_FIELD = '__crmRecordCount'
const ALL_ROWS_FIELD = '__crmAllRows'
const CRM_FONT_FAMILY = 'Inter, system-ui, sans-serif'
const CRM_BORDER_COLOR = '#e2e8f0'
const CRM_HEADER_BG = '#f1f5f9'
const CRM_ROW_HEADER_BG = '#f8fafc'
const CRM_BODY_BG = '#ffffff'
const CRM_PRIMARY_TEXT = '#1e293b'
const CRM_SECONDARY_TEXT = '#334155'

interface VTableFieldBinding {
  sourceField: string
  vtableField: string
  title: string
}

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
): PivotTableConstructorOptions {
  const rowBindings = (pivot.rows ?? []).map((field, index) =>
    dimensionBinding(field, 'row', index),
  )
  const columnBindings = (pivot.columns ?? []).map((field, index) =>
    dimensionBinding(field, 'column', index),
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
      }]

  return {
    records: rows.map((row) =>
      flattenReportRow(
        row,
        [
          ...effectiveRows,
          ...columnBindings,
          ...valueBindings,
        ],
        labels,
      ),
    ),
    rows: effectiveRows.map(toRowDimension),
    columns: columnBindings.map(toColumnDimension),
    indicators: valueBindings.map((binding, index) =>
      toIndicator(values[index], binding),
    ),
    indicatorsAsCol: true,
    hideIndicatorName: valueBindings.length === 1,
    theme: CRM_VTABLE_THEME,
    rowHierarchyType: rowBindings.length > 0 ? 'tree' : 'grid',
    rowExpandLevel: Math.max(1, effectiveRows.length),
    rowHierarchyIndent: 16,
    rowHierarchyTextStartAlignment: true,
    columnHierarchyType: 'grid',
    widthMode: 'standard',
    heightMode: 'standard',
    columnHeaderTitle: columnBindings.length > 0
      ? {
          title: titleList(columnBindings),
          headerType: 'text',
        }
      : undefined,
    indicatorTitle: titleList(valueBindings),
    dataConfig: {
      aggregationRules: valueBindings.map((binding, index) => ({
        indicatorKey: binding.vtableField,
        field: values[index].aggregate === 'count'
          ? COUNT_FIELD
          : binding.vtableField,
        aggregationType: aggregateType(values[index].aggregate),
        formatFun: (value: number | string) =>
          formatAggregateValue(value, values[index].aggregate),
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

const CRM_VTABLE_THEME: TYPES.ITableThemeDefine = {
  underlayBackgroundColor: CRM_BODY_BG,
  defaultStyle: {
    fontFamily: CRM_FONT_FAMILY,
    fontSize: 12,
    color: CRM_SECONDARY_TEXT,
    bgColor: CRM_BODY_BG,
    borderColor: CRM_BORDER_COLOR,
    borderLineWidth: 1,
    padding: [8, 10, 8, 10],
    textBaseline: 'middle',
  },
  headerStyle: {
    fontFamily: CRM_FONT_FAMILY,
    fontSize: 12,
    fontWeight: 700,
    color: CRM_PRIMARY_TEXT,
    bgColor: CRM_HEADER_BG,
    borderColor: CRM_BORDER_COLOR,
    borderLineWidth: 1,
    padding: [8, 10, 8, 10],
    textBaseline: 'middle',
  },
  rowHeaderStyle: {
    fontFamily: CRM_FONT_FAMILY,
    fontSize: 12,
    fontWeight: 600,
    color: CRM_SECONDARY_TEXT,
    bgColor: CRM_ROW_HEADER_BG,
    borderColor: CRM_BORDER_COLOR,
    borderLineWidth: 1,
    padding: [8, 10, 8, 10],
    textBaseline: 'middle',
  },
  cornerHeaderStyle: {
    fontFamily: CRM_FONT_FAMILY,
    fontSize: 12,
    fontWeight: 700,
    color: CRM_PRIMARY_TEXT,
    bgColor: CRM_HEADER_BG,
    borderColor: CRM_BORDER_COLOR,
    borderLineWidth: 1,
    padding: [8, 10, 8, 10],
    textBaseline: 'middle',
  },
  bodyStyle: {
    fontFamily: CRM_FONT_FAMILY,
    fontSize: 12,
    color: CRM_SECONDARY_TEXT,
    bgColor: CRM_BODY_BG,
    borderColor: CRM_BORDER_COLOR,
    borderLineWidth: 1,
    padding: [8, 10, 8, 10],
    textAlign: 'right',
    textBaseline: 'middle',
  },
  bottomFrozenStyle: {
    fontFamily: CRM_FONT_FAMILY,
    fontSize: 12,
    fontWeight: 700,
    color: CRM_PRIMARY_TEXT,
    bgColor: CRM_ROW_HEADER_BG,
    borderColor: CRM_BORDER_COLOR,
    borderLineWidth: 1,
    padding: [8, 10, 8, 10],
    textAlign: 'right',
    textBaseline: 'middle',
  },
  frameStyle: {
    borderColor: CRM_BORDER_COLOR,
    borderLineWidth: 1,
    cornerRadius: 8,
  },
  scrollStyle: {
    scrollRailColor: '#f8fafc',
    scrollSliderColor: '#cbd5e1',
    scrollSliderCornerRadius: 6,
    width: 8,
    visible: 'scrolling',
    hoverOn: true,
  },
  selectionStyle: {
    cellBorderColor: '#10b981',
    cellBorderLineWidth: 1,
    cellBgColor: '#ecfdf5',
    inlineRowBgColor: '#f0fdf4',
    inlineColumnBgColor: '#f0fdf4',
  },
  tooltipStyle: {
    fontFamily: CRM_FONT_FAMILY,
    fontSize: 12,
    color: CRM_SECONDARY_TEXT,
    bgColor: CRM_BODY_BG,
    padding: [8, 10],
    maxWidth: 320,
  },
}

function flattenReportRow(
  row: Record<string, unknown>,
  bindings: VTableFieldBinding[],
  labels: ReportVTableLabels,
): Record<string, unknown> {
  const flattened: Record<string, unknown> = {
    [COUNT_FIELD]: 1,
    [ALL_ROWS_FIELD]: labels.allRecords,
  }

  for (const binding of bindings) {
    if (binding.sourceField === ALL_ROWS_FIELD) {
      flattened[binding.vtableField] = labels.allRecords
      continue
    }

    const value = getPathValue(row, binding.sourceField)
    flattened[binding.vtableField] = binding.vtableField.startsWith('value_')
      ? numericValue(value)
      : dimensionValue(value, labels)
  }

  return flattened
}

function normalizedValues(values: ReportPivotValue[]): ReportPivotValue[] {
  return values.length > 0
    ? values
    : [{ field: COUNT_FIELD, aggregate: 'count' }]
}

function dimensionBinding(
  field: string,
  kind: 'row' | 'column',
  index: number,
): VTableFieldBinding {
  return {
    sourceField: field,
    vtableField: `${kind}_${index}_${safeFieldKey(field)}`,
    title: field,
  }
}

function valueBinding(
  value: ReportPivotValue,
  index: number,
  labels = DEFAULT_REPORT_VTABLE_LABELS,
): VTableFieldBinding {
  return {
    sourceField: value.field,
    vtableField: `value_${index}_${safeFieldKey(value.field)}_${value.aggregate}`,
    title: value.aggregate === 'count'
      ? `${labels.count} ${value.field === '*' ? '' : value.field}`.trim()
      : `${aggregateTitle(value.aggregate, labels)} ${value.field}`,
  }
}

function toRowDimension(binding: VTableFieldBinding): IDimension {
  return {
    dimensionKey: binding.vtableField,
    title: binding.title,
    headerStyle: {
      textStick: true,
    },
    width: 'auto',
  }
}

function toColumnDimension(binding: VTableFieldBinding): IDimension {
  return {
    dimensionKey: binding.vtableField,
    title: binding.title,
  }
}

function toIndicator(
  value: ReportPivotValue,
  binding: VTableFieldBinding,
): IIndicator {
  return {
    indicatorKey: binding.vtableField,
    title: binding.title,
    cellType: 'text',
    style: {
      textAlign: 'right',
    },
    format: (cellValue: unknown) =>
      value.aggregate === 'count'
        ? String(cellValue ?? 0)
        : formatAggregateValue(cellValue, value.aggregate),
  } as IIndicator
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

function dimensionValue(value: unknown, labels: ReportVTableLabels): string {
  if (value === null || value === undefined || value === '') return labels.emptyValue
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.__crmValueType === 'm2o' && record.label !== undefined && record.label !== null) {
      return String(record.label)
    }
    return String(record.name ?? record.title ?? record.label ?? record.id ?? JSON.stringify(record))
  }
  return String(value)
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function formatAggregateValue(
  value: unknown,
  aggregate: ReportAggregate,
): string {
  if (value === null || value === undefined || value === '') {
    return aggregate === 'count' ? '0' : ''
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return Number.isInteger(numeric)
    ? String(numeric)
    : numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function safeFieldKey(field: string): string {
  return field
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'field'
}
