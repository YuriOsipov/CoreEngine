import type { ReportAggregate, ReportPivotValue, ReportSortDirection } from './reportSettings'

/** Dimension member order by aggregated row total (first value). */
export function orderedRowLabelsByTotal(
  records: Record<string, unknown>[],
  rowField: string,
  value: ReportPivotValue,
  indicatorField: string,
  sort: ReportSortDirection,
  emptyLabel: string,
): string[] {
  const groups = new Map<string, number[]>()
  for (const record of records) {
    const label = String(record[rowField] ?? emptyLabel)
    const bucket = groups.get(label) ?? []
    if (value.aggregate === 'count') {
      bucket.push(1)
    } else {
      const numeric = numericValue(record[indicatorField])
      if (numeric !== null) bucket.push(numeric)
    }
    groups.set(label, bucket)
  }

  return Array.from(groups.entries())
    .map(([label, numbers]) => ({
      label,
      total: reduceAggregate(numbers, value.aggregate),
    }))
    .sort((a, b) => {
      const byValue = a.total - b.total
      if (byValue !== 0) return sort === 'desc' ? -byValue : byValue
      return a.label.localeCompare(b.label)
    })
    .map((item) => item.label)
}

function reduceAggregate(numbers: number[], aggregate: ReportAggregate): number {
  if (aggregate === 'count') return numbers.length
  if (numbers.length === 0) return 0
  if (aggregate === 'avg') {
    return numbers.reduce((sum, item) => sum + item, 0) / numbers.length
  }
  if (aggregate === 'min') return Math.min(...numbers)
  if (aggregate === 'max') return Math.max(...numbers)
  return numbers.reduce((sum, item) => sum + item, 0)
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}
