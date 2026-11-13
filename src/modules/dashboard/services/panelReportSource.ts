import { getPathValue } from '@/modules/entities/utils/recordDisplay'
import {
  executeReport,
  getReportBySettingId,
  isPivotReport,
  resolveReportDateGrains,
  type ReportPivotDimension,
  type ReportPivotValue,
  type ReportSortDirection,
} from '@/modules/reports/services/reportSettings'
import { dimensionDisplayValue } from '@/modules/reports/services/reportVTableAdapter'

export interface ReportPanelSeries {
  title: string
  labels: string[]
  values: number[]
  valueLabel: string
}

/** Run a saved report and flatten it to a single chart/metric series. */
export async function loadReportPanelSeries(
  reportSettingId: string,
): Promise<ReportPanelSeries | null> {
  const report = await getReportBySettingId(reportSettingId)
  if (!report) return null

  const config = await resolveReportDateGrains(report.config)
  // Chart/metric panels require pivot aggregates; tabular reports are skipped.
  if (!isPivotReport(config) || !config.collection || config.pivot.values.length === 0) {
    return null
  }

  const rows = await executeReport(config)
  const value = config.pivot.values[0]
  const category =
    config.pivot.rows[0] ??
    config.pivot.columns[0] ??
    null

  const valueLabel = formatValueLabel(value)

  if (!category) {
    return {
      title: config.title || report.title || report.name,
      labels: [valueLabel],
      values: [aggregateRows(rows, value)],
      valueLabel,
    }
  }

  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const key = categoryLabel(row, category)
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  }

  const entries = Array.from(groups.entries()).map(([label, groupRows]) => ({
    label,
    value: aggregateRows(groupRows, value),
  }))

  const sortRowsByTotal = config.pivot.sortRowsByTotal
  const ordered = sortSeriesEntries(
    entries,
    sortRowsByTotal === 'asc' || sortRowsByTotal === 'desc'
      ? sortRowsByTotal
      : null,
    category.sort === 'desc' ? 'desc' : 'asc',
  )

  return {
    title: config.title || report.title || report.name,
    labels: ordered.map((item) => item.label),
    values: ordered.map((item) => item.value),
    valueLabel,
  }
}

function sortSeriesEntries(
  entries: Array<{ label: string; value: number }>,
  sortByTotal: ReportSortDirection | null,
  labelSort: ReportSortDirection,
): Array<{ label: string; value: number }> {
  return [...entries].sort((a, b) => {
    if (sortByTotal) {
      const byValue = a.value - b.value
      if (byValue !== 0) return sortByTotal === 'desc' ? -byValue : byValue
    }
    const byLabel = a.label.localeCompare(b.label)
    return labelSort === 'desc' ? -byLabel : byLabel
  })
}

function categoryLabel(
  row: Record<string, unknown>,
  dimension: ReportPivotDimension,
): string {
  return dimensionDisplayValue(
    getPathValue(row, dimension.field),
    '(empty)',
    dimension.dateGrain,
  )
}

function formatValueLabel(value: ReportPivotValue): string {
  if (value.aggregate === 'count' && (value.field === '*' || !value.field)) {
    return 'count'
  }
  return `${value.aggregate} ${value.field}`
}

function aggregateRows(
  rows: Record<string, unknown>[],
  pivotValue: ReportPivotValue,
): number {
  if (pivotValue.aggregate === 'count') return rows.length

  const numbers = rows
    .map((row) => numericValue(getPathValue(row, pivotValue.field)))
    .filter((item): item is number => item !== null)

  if (numbers.length === 0) return 0
  if (pivotValue.aggregate === 'sum') {
    return numbers.reduce((sum, item) => sum + item, 0)
  }
  if (pivotValue.aggregate === 'avg') {
    return numbers.reduce((sum, item) => sum + item, 0) / numbers.length
  }
  if (pivotValue.aggregate === 'min') return Math.min(...numbers)
  if (pivotValue.aggregate === 'max') return Math.max(...numbers)
  return numbers.length
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}
