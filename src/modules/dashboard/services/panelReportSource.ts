import { getPathValue } from '@/modules/entities/utils/recordDisplay'
import {
  executeReport,
  getReportBySettingId,
  reportAsPivotSettings,
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
  const pivot = reportAsPivotSettings(config.tabular) ?? (
    config.pivot.values.length > 0 ? config.pivot : null
  )
  if (!config.collection || !pivot || pivot.values.length === 0) {
    return null
  }

  const rows = await executeReport(config)
  const value = pivot.values[0]!
  const category =
    pivot.rows[0] ??
    pivot.columns[0] ??
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

  const sortRowsByTotal = pivot.sortRowsByTotal ?? config.tabular.sortRowsByTotal
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

function categoryLabel(
  row: Record<string, unknown>,
  category: ReportPivotDimension,
): string {
  return dimensionDisplayValue(
    getPathValue(row, category.field),
    '(empty)',
    category.dateGrain,
  )
}

function aggregateRows(
  rows: Record<string, unknown>[],
  value: ReportPivotValue,
): number {
  if (value.aggregate === 'count') return rows.length
  const numbers = rows
    .map((row) => {
      const raw = getPathValue(row, value.field)
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
      if (typeof raw === 'string' && raw.trim()) {
        const numeric = Number(raw)
        return Number.isFinite(numeric) ? numeric : null
      }
      return null
    })
    .filter((entry): entry is number => entry !== null)
  if (numbers.length === 0) return 0
  if (value.aggregate === 'avg') {
    return numbers.reduce((sum, entry) => sum + entry, 0) / numbers.length
  }
  if (value.aggregate === 'min') return Math.min(...numbers)
  if (value.aggregate === 'max') return Math.max(...numbers)
  return numbers.reduce((sum, entry) => sum + entry, 0)
}

function formatValueLabel(value: ReportPivotValue): string {
  const leaf = value.field === '*' ? '' : value.field
  if (value.aggregate === 'count') return `Count ${leaf}`.trim()
  if (value.aggregate === 'avg') return `Avg of ${leaf}`.trim()
  if (value.aggregate === 'min') return `Min of ${leaf}`.trim()
  if (value.aggregate === 'max') return `Max of ${leaf}`.trim()
  return `Sum of ${leaf}`.trim()
}

function sortSeriesEntries(
  entries: Array<{ label: string; value: number }>,
  sortByTotal: ReportSortDirection | null,
  labelSort: ReportSortDirection,
): Array<{ label: string; value: number }> {
  return [...entries].sort((a, b) => {
    if (sortByTotal) {
      const cmp = a.value - b.value
      return sortByTotal === 'desc' ? -cmp : cmp
    }
    const cmp = a.label.localeCompare(b.label, undefined, { numeric: true })
    return labelSort === 'desc' ? -cmp : cmp
  })
}
