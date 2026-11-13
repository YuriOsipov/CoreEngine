import { getPathValue } from '@/modules/entities/utils/recordDisplay'
import { formatReportAggregateValue, formatReportCellDisplay } from './reportCellDisplay'
import type {
  ReportDefinition,
  ReportSummaryAggregate,
  ReportTabularColumn,
  ReportTabularGroup,
  ReportTabularSettings,
} from './reportSettings'

export type TabularDisplayRowKind = 'group' | 'detail' | 'subtotal' | 'grandtotal'

export interface TabularDisplayColumn {
  field: string
  header: string
  isGroup?: boolean
  hasSummary?: boolean
}

export interface TabularDisplayRow {
  key: string
  kind: TabularDisplayRowKind
  level?: number
  label?: string
  source?: Record<string, unknown>
  cells: Record<string, string>
}

export function formatTabularCell(
  row: Record<string, unknown>,
  field: string,
): string {
  return formatReportCellDisplay(getPathValue(row, field), null, '')
}

export function computeSummary(
  rows: Record<string, unknown>[],
  field: string,
  aggregate: ReportSummaryAggregate,
): number | null {
  const numbers = rows
    .map((row) => numericValue(getPathValue(row, field)))
    .filter((value): value is number => value !== null)
  if (numbers.length === 0) return null
  if (aggregate === 'sum') return numbers.reduce((sum, value) => sum + value, 0)
  if (aggregate === 'avg') {
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
  }
  if (aggregate === 'min') return Math.min(...numbers)
  if (aggregate === 'max') return Math.max(...numbers)
  if (aggregate === 'median') {
    const sorted = [...numbers].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!
  }
  return null
}

export function buildTabularDisplayColumns(
  report: Pick<ReportDefinition, 'tabular'>,
  fieldLabels: Record<string, string> = {},
): TabularDisplayColumn[] {
  const tabular = report.tabular
  const columns: TabularDisplayColumn[] = []

  for (const group of tabular.groupRows) {
    columns.push({
      field: `group:${group.field}`,
      header: fieldLabels[group.field] || group.field,
      isGroup: true,
    })
  }

  for (const column of tabular.columns) {
    const base = fieldLabels[column.field] || column.field
    const summaries = column.summaries ?? []
    columns.push({
      field: column.field,
      header:
        summaries.length === 1
          ? `${summaryHeader(summaries[0]!)} ${base}`
          : summaries.length > 1
            ? `${base} (${summaries.map(summaryHeader).join(', ')})`
            : base,
      hasSummary: summaries.length > 0,
    })
  }

  return columns
}

export function buildTabularDisplayRows(
  report: Pick<ReportDefinition, 'tabular'>,
  rows: Record<string, unknown>[],
  fieldLabels: Record<string, string> = {},
): TabularDisplayRow[] {
  const tabular = report.tabular
  const ordered = orderRows(rows, tabular.groupRows, tabular.columns)
  if (tabular.groupRows.length === 0) {
    return ordered.map((row, index) => detailRow(row, index, tabular))
  }

  const display: TabularDisplayRow[] = []
  appendGroupedRows(display, ordered, tabular, fieldLabels, 0, {})

  if (tabular.showGrandTotal !== false && hasAnySummary(tabular.columns)) {
    display.push(
      aggregateRow(
        'grandtotal',
        'grand',
        tabular,
        ordered,
        {},
        'Grand Total',
      ),
    )
  }
  return display
}

function appendGroupedRows(
  display: TabularDisplayRow[],
  rows: Record<string, unknown>[],
  tabular: ReportTabularSettings,
  fieldLabels: Record<string, string>,
  level: number,
  pathValues: Record<string, string>,
): void {
  const group = tabular.groupRows[level]
  if (!group) return

  const buckets = groupRowsBy(rows, group.field, group.sort ?? 'asc')
  const isLeaf = level >= tabular.groupRows.length - 1

  for (const [value, bucket] of buckets) {
    const labelValue = value || '(empty)'
    const nextPath = {
      ...pathValues,
      [`group:${group.field}`]: labelValue,
    }
    const pathKey = Object.entries(nextPath)
      .map(([field, label]) => `${field}=${label}`)
      .join('|')

    if (!isLeaf) {
      display.push(
        aggregateRow(
          'group',
          `group_${pathKey}`,
          tabular,
          bucket,
          nextPath,
          undefined,
          level,
        ),
      )
      appendGroupedRows(display, bucket, tabular, fieldLabels, level + 1, nextPath)
      continue
    }

    // Leaf group: one aggregated row per group value (e.g. SUM base_price by item).
    if (hasAnySummary(tabular.columns) || tabular.showDetailRows === false) {
      display.push(
        aggregateRow(
          'group',
          `group_${pathKey}`,
          tabular,
          bucket,
          nextPath,
          undefined,
          level,
        ),
      )
    } else {
      display.push({
        key: `group_${pathKey}`,
        kind: 'group',
        level,
        cells: {
          ...nextPath,
          ...blankMeasureCells(tabular.columns),
        },
      })
    }

    if (tabular.showDetailRows !== false) {
      bucket.forEach((row, index) => {
        display.push(detailRow(row, `${pathKey}_${index}`, tabular, nextPath, level + 1))
      })
    }

    // Subtotal only when details are visible (aggregate already on the group row).
    if (
      tabular.showDetailRows !== false &&
      tabular.showSubtotals !== false &&
      hasAnySummary(tabular.columns)
    ) {
      display.push(
        aggregateRow(
          'subtotal',
          `sub_${pathKey}`,
          tabular,
          bucket,
          nextPath,
          `Subtotal · ${labelValue}`,
          level,
        ),
      )
    }
  }
}

function detailRow(
  row: Record<string, unknown>,
  key: string | number,
  tabular: ReportTabularSettings,
  pathValues: Record<string, string> = {},
  level = 0,
): TabularDisplayRow {
  const cells: Record<string, string> = { ...pathValues }
  for (const column of tabular.columns) {
    cells[column.field] = formatTabularCell(row, column.field)
  }
  // Indent nested details under group labels.
  for (const group of tabular.groupRows) {
    const groupKey = `group:${group.field}`
    if (level > 0 && cells[groupKey]) {
      cells[groupKey] = ''
    }
  }
  return {
    key: `detail_${key}`,
    kind: 'detail',
    level,
    source: row,
    cells,
  }
}

function aggregateRow(
  kind: 'group' | 'subtotal' | 'grandtotal',
  key: string,
  tabular: ReportTabularSettings,
  rows: Record<string, unknown>[],
  pathValues: Record<string, string>,
  overrideLabel?: string,
  level = 0,
): TabularDisplayRow {
  const cells: Record<string, string> = { ...pathValues }

  if (kind === 'grandtotal') {
    const firstGroup = tabular.groupRows[0]
    if (firstGroup) {
      cells[`group:${firstGroup.field}`] = overrideLabel || 'Grand Total'
    }
    for (const group of tabular.groupRows.slice(1)) {
      cells[`group:${group.field}`] = ''
    }
  } else if (kind === 'subtotal') {
    const leaf = tabular.groupRows[tabular.groupRows.length - 1]
    if (leaf) {
      cells[`group:${leaf.field}`] = overrideLabel || 'Subtotal'
    }
  }

  for (const column of tabular.columns) {
    const summaries = column.summaries ?? []
    if (summaries.length === 0) {
      cells[column.field] = ''
      continue
    }
    cells[column.field] = summaries
      .map((aggregate) => {
        const value = computeSummary(rows, column.field, aggregate)
        if (value === null) return ''
        const formatted = formatReportAggregateValue(
          value,
          aggregate === 'median' ? 'avg' : aggregate,
        )
        return summaries.length > 1
          ? `${aggregateLabel(aggregate)} ${formatted}`
          : formatted
      })
      .filter(Boolean)
      .join(' · ')
  }

  return {
    key: `${kind}_${key}`,
    kind,
    level,
    label: overrideLabel,
    cells,
  }
}

function blankMeasureCells(columns: ReportTabularColumn[]): Record<string, string> {
  const cells: Record<string, string> = {}
  for (const column of columns) {
    cells[column.field] = ''
  }
  return cells
}

function hasAnySummary(columns: ReportTabularColumn[]): boolean {
  return columns.some((column) => (column.summaries?.length ?? 0) > 0)
}

function summaryHeader(aggregate: ReportSummaryAggregate): string {
  if (aggregate === 'avg') return 'Avg of'
  if (aggregate === 'median') return 'Median of'
  if (aggregate === 'sum') return 'Sum of'
  if (aggregate === 'min') return 'Min of'
  if (aggregate === 'max') return 'Max of'
  return aggregate
}

function aggregateLabel(aggregate: ReportSummaryAggregate): string {
  if (aggregate === 'avg') return 'Avg'
  if (aggregate === 'median') return 'Med'
  return aggregate.charAt(0).toUpperCase() + aggregate.slice(1)
}

function groupRowsBy(
  rows: Record<string, unknown>[],
  field: string,
  sort: 'asc' | 'desc',
): Array<[string, Record<string, unknown>[]]> {
  const map = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const label = formatTabularCell(row, field) || '(empty)'
    const bucket = map.get(label) ?? []
    bucket.push(row)
    map.set(label, bucket)
  }
  return Array.from(map.entries()).sort(([a], [b]) => {
    const cmp = a.localeCompare(b, undefined, { numeric: true })
    return sort === 'desc' ? -cmp : cmp
  })
}

function orderRows(
  rows: Record<string, unknown>[],
  groupRows: ReportTabularGroup[],
  columns: ReportTabularColumn[],
): Record<string, unknown>[] {
  const sortSpecs = [
    ...groupRows.map((group) => ({
      field: group.field,
      sort: group.sort ?? 'asc' as const,
    })),
    ...columns
      .filter((column) => column.sort === 'asc' || column.sort === 'desc')
      .map((column) => ({
        field: column.field,
        sort: column.sort as 'asc' | 'desc',
      })),
  ]
  if (sortSpecs.length === 0) return [...rows]
  return [...rows].sort((a, b) => {
    for (const spec of sortSpecs) {
      const left = formatTabularCell(a, spec.field)
      const right = formatTabularCell(b, spec.field)
      const cmp = left.localeCompare(right, undefined, { numeric: true })
      if (cmp !== 0) return spec.sort === 'desc' ? -cmp : cmp
    }
    return 0
  })
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.value === 'number') return record.value
  }
  return null
}
