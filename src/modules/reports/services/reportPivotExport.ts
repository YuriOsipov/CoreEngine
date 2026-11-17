import * as XLSX from 'xlsx'
import { getOrgCurrencySymbol } from '@/core/orgLocale'
import { getPathValue, type NumberDisplayOptions } from '@/modules/entities/utils/recordDisplay'
import { dimensionDisplayValue } from './reportVTableAdapter'
import {
  reportAsPivotSettings,
  reportFieldDisplayLabel,
  tabularAsPivotSettings,
  type ReportAggregate,
  type ReportDefinition,
  type ReportPivotDimension,
  type ReportPivotSettings,
  type ReportPivotValue,
  type ReportSummaryAggregate,
  type ReportTabularSettings,
} from './reportSettings'

const EMPTY_LABEL = '(empty)'
const TOTAL_LABEL = 'Total'

export function isSummaryOnlyTabular(tabular: ReportTabularSettings): boolean {
  // Matrix (group columns) always renders as a pivot summary on screen.
  if (tabular.groupColumns.length > 0) return true
  if (tabular.showDetailRows === true) return false
  if (tabular.groupRows.length === 0) return false
  return tabular.columns.some((column) => (column.summaries?.length ?? 0) > 0)
}

/** Pivot settings for summary-style XLSX, or null to keep Details Only. */
export function resolveExportPivotSettings(
  report: Pick<ReportDefinition, 'type' | 'tabular' | 'pivot'>,
): ReportPivotSettings | null {
  if (!isSummaryOnlyTabular(report.tabular)) return null
  return (
    reportAsPivotSettings(report.tabular) ??
    tabularAsPivotSettings(report.tabular) ??
    null
  )
}

export interface PivotExportSheet {
  aoa: Array<Array<string | number | null>>
  sheetName: string
  /** Data body rows (excluding title / header / total). */
  dataRowCount: number
  /** Excel number formats for measure cells (0-based row/col). */
  numberFormats: Array<{ r: number; c: number; z: string }>
}

export function buildPivotStyleSheetAoa(
  report: Pick<ReportDefinition, 'name' | 'title' | 'tabular'>,
  pivot: ReportPivotSettings,
  rows: Record<string, unknown>[],
  fieldLabels: Record<string, string> = {},
  numberDisplayByField: Record<string, NumberDisplayOptions> = {},
  filterLines: string[] = [],
): PivotExportSheet {
  const rowDims = pivot.rows.filter((dimension) => Boolean(dimension.field))
  const colDims = pivot.columns.filter((dimension) => Boolean(dimension.field))
  const values = normalizeExportValues(pivot.values)

  const aggregated = aggregatePivotRecords(rows, rowDims, colDims, values)

  const rowKeys = sortKeyList(aggregated.rowKeys, rowDims.map((d) => d.sort ?? 'asc'))
  const colKeys = sortKeyList(aggregated.colKeys, colDims.map((d) => d.sort ?? 'asc'))

  const measureTitles = values.map((value) =>
    measureTitle(value, fieldLabels[value.field] || reportFieldDisplayLabel(value.field)),
  )
  const rowHeaderTitles = rowDims.map(
    (dimension) => fieldLabels[dimension.field] || reportFieldDisplayLabel(dimension.field),
  )
  const showColumnTotals = colDims.length > 0
  const showGrandTotal = report.tabular?.showGrandTotal !== false
  const multiMeasure = values.length > 1

  const aoa: Array<Array<string | number | null>> = []
  const numberFormats: Array<{ r: number; c: number; z: string }> = []
  const title = report.title || report.name || 'Report'
  aoa.push([title])
  aoa.push([`As of ${formatAsOfTimestamp()}`])
  aoa.push([])
  appendFilteredByBlock(aoa, filterLines)

  // Header band
  if (colDims.length > 0) {
    const top: Array<string | number | null> = [
      ...rowHeaderTitles.map((_, index) => (index === 0 ? '' : '')),
    ]
    // Pad row-header columns
    while (top.length < Math.max(1, rowHeaderTitles.length)) top.push('')
    for (const colKey of colKeys) {
      const label = colKey.split('\u0001').join(' / ')
      top.push(label)
      if (multiMeasure) {
        for (let i = 1; i < values.length; i += 1) top.push('')
      }
    }
    if (showColumnTotals) {
      top.push(TOTAL_LABEL)
      if (multiMeasure) {
        for (let i = 1; i < values.length; i += 1) top.push('')
      }
    }
    aoa.push(top)

    const measureRow: Array<string | number | null> = [
      ...(rowHeaderTitles.length > 0 ? rowHeaderTitles : ['']),
    ]
    const blockCount = colKeys.length + (showColumnTotals ? 1 : 0)
    for (let b = 0; b < blockCount; b += 1) {
      for (const measureTitleText of measureTitles) {
        measureRow.push(measureTitleText)
      }
    }
    aoa.push(measureRow)
  } else {
    aoa.push([
      ...(rowHeaderTitles.length > 0 ? rowHeaderTitles : ['']),
      ...measureTitles,
    ])
  }

  const headerRowCount = aoa.length

  for (const rowKey of rowKeys) {
    const rowLabels = rowKey === '' ? [EMPTY_LABEL] : rowKey.split('\u0001')
    const line: Array<string | number | null> = [
      ...padLabels(rowLabels, Math.max(1, rowDims.length)),
    ]
    const rowIndex = aoa.length

    if (colDims.length > 0) {
      const rowTotals = values.map(() => createAccumulator())
      for (const colKey of colKeys) {
        const cell = aggregated.cells.get(cellMapKey(rowKey, colKey))
        for (let vi = 0; vi < values.length; vi += 1) {
          const raw = resolveAggregate(cell?.[vi], values[vi]!.aggregate)
          pushMeasureCell(line, numberFormats, rowIndex, raw, values[vi]!, numberDisplayByField)
          if (cell?.[vi]) mergeAccumulators(rowTotals[vi]!, cell[vi]!)
        }
      }
      if (showColumnTotals) {
        for (let vi = 0; vi < values.length; vi += 1) {
          const raw = finalizeAccumulator(rowTotals[vi]!, values[vi]!.aggregate)
          pushMeasureCell(line, numberFormats, rowIndex, raw, values[vi]!, numberDisplayByField)
        }
      }
    } else {
      const cell = aggregated.cells.get(cellMapKey(rowKey, ''))
      for (let vi = 0; vi < values.length; vi += 1) {
        const raw = resolveAggregate(cell?.[vi], values[vi]!.aggregate)
        pushMeasureCell(line, numberFormats, rowIndex, raw, values[vi]!, numberDisplayByField)
      }
    }

    aoa.push(line)
  }

  if (showGrandTotal && rowKeys.length > 0) {
    const totalLine: Array<string | number | null> = [
      TOTAL_LABEL,
      ...Array.from({ length: Math.max(0, rowDims.length - 1) }, () => ''),
    ]
    const totalRowIndex = aoa.length

    if (colDims.length > 0) {
      const grandByMeasure = values.map(() => createAccumulator())
      for (const colKey of colKeys) {
        const colTotals = values.map(() => createAccumulator())
        for (const rowKey of rowKeys) {
          const cell = aggregated.cells.get(cellMapKey(rowKey, colKey))
          for (let vi = 0; vi < values.length; vi += 1) {
            if (!cell?.[vi]) continue
            mergeAccumulators(colTotals[vi]!, cell[vi]!)
            mergeAccumulators(grandByMeasure[vi]!, cell[vi]!)
          }
        }
        for (let vi = 0; vi < values.length; vi += 1) {
          const raw = finalizeAccumulator(colTotals[vi]!, values[vi]!.aggregate)
          pushMeasureCell(
            totalLine,
            numberFormats,
            totalRowIndex,
            raw,
            values[vi]!,
            numberDisplayByField,
          )
        }
      }
      if (showColumnTotals) {
        for (let vi = 0; vi < values.length; vi += 1) {
          const raw = finalizeAccumulator(grandByMeasure[vi]!, values[vi]!.aggregate)
          pushMeasureCell(
            totalLine,
            numberFormats,
            totalRowIndex,
            raw,
            values[vi]!,
            numberDisplayByField,
          )
        }
      }
    } else {
      const grandByMeasure = values.map(() => createAccumulator())
      for (const rowKey of rowKeys) {
        const cell = aggregated.cells.get(cellMapKey(rowKey, ''))
        for (let vi = 0; vi < values.length; vi += 1) {
          if (!cell?.[vi]) continue
          mergeAccumulators(grandByMeasure[vi]!, cell[vi]!)
        }
      }
      for (let vi = 0; vi < values.length; vi += 1) {
        const raw = finalizeAccumulator(grandByMeasure[vi]!, values[vi]!.aggregate)
        pushMeasureCell(
          totalLine,
          numberFormats,
          totalRowIndex,
          raw,
          values[vi]!,
          numberDisplayByField,
        )
      }
    }

    aoa.push(totalLine)
  }

  return {
    aoa,
    sheetName: sanitizeSheetName(title),
    dataRowCount: Math.max(0, aoa.length - headerRowCount - (showGrandTotal && rowKeys.length > 0 ? 1 : 0)),
    numberFormats,
  }
}

export function downloadPivotStyleXlsx(
  filename: string,
  sheet: PivotExportSheet,
): void {
  const safeName = filename.toLowerCase().endsWith('.xlsx')
    ? filename
    : `${filename.replace(/\.(xlsx|xls|csv)$/i, '')}.xlsx`
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet(sheet.aoa)
  for (const format of sheet.numberFormats) {
    const addr = XLSX.utils.encode_cell({ r: format.r, c: format.c })
    const cell = worksheet[addr]
    if (!cell) continue
    cell.t = 'n'
    cell.z = format.z
  }
  XLSX.utils.book_append_sheet(workbook, worksheet, sheet.sheetName)
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeName
  anchor.click()
  URL.revokeObjectURL(url)
}

interface MeasureAccumulator {
  sum: number
  count: number
  min: number | null
  max: number | null
}

interface AggregatedPivot {
  rowKeys: string[]
  colKeys: string[]
  cells: Map<string, MeasureAccumulator[]>
}

function aggregatePivotRecords(
  rows: Record<string, unknown>[],
  rowDims: ReportPivotDimension[],
  colDims: ReportPivotDimension[],
  values: ReportPivotValue[],
): AggregatedPivot {
  const cells = new Map<string, MeasureAccumulator[]>()
  const rowKeySet = new Set<string>()
  const colKeySet = new Set<string>()

  for (const row of rows) {
    const rowParts = rowDims.map((dimension) =>
      dimensionDisplayValue(
        getPathValue(row, dimension.field),
        EMPTY_LABEL,
        dimension.dateGrain,
      ),
    )
    const colParts = colDims.map((dimension) =>
      dimensionDisplayValue(
        getPathValue(row, dimension.field),
        EMPTY_LABEL,
        dimension.dateGrain,
      ),
    )
    const rowKey = rowParts.join('\u0001')
    const colKey = colParts.join('\u0001')
    rowKeySet.add(rowKey)
    colKeySet.add(colKey)

    const key = cellMapKey(rowKey, colKey)
    let bucket = cells.get(key)
    if (!bucket) {
      bucket = values.map(() => createAccumulator())
      cells.set(key, bucket)
    }

    for (let vi = 0; vi < values.length; vi += 1) {
      const value = values[vi]!
      if (value.aggregate === 'count') {
        mergeAccumulator(bucket[vi]!, 1, 'count')
        continue
      }
      const numeric = toNumeric(getPathValue(row, value.field))
      if (numeric === null) continue
      mergeAccumulator(bucket[vi]!, numeric, value.aggregate)
    }
  }

  return {
    rowKeys: Array.from(rowKeySet),
    colKeys: colDims.length > 0 ? Array.from(colKeySet) : [''],
    cells,
  }
}

function normalizeExportValues(values: ReportPivotValue[]): ReportPivotValue[] {
  const next = values
    .filter((value) => value.field)
    .map((value) => ({
      field: value.field,
      aggregate: value.aggregate,
    }))
  return next.length > 0 ? next : [{ field: 'id', aggregate: 'count' }]
}

function measureTitle(value: ReportPivotValue, leafLabel: string): string {
  if (value.aggregate === 'count') return `Count ${leafLabel}`.trim()
  if (value.aggregate === 'avg') return `Avg of ${leafLabel}`.trim()
  if (value.aggregate === 'min') return `Min of ${leafLabel}`.trim()
  if (value.aggregate === 'max') return `Max of ${leafLabel}`.trim()
  return `Sum of ${leafLabel}`.trim()
}

function createAccumulator(): MeasureAccumulator {
  return { sum: 0, count: 0, min: null, max: null }
}

function mergeAccumulator(
  acc: MeasureAccumulator,
  value: number,
  _aggregate: ReportAggregate | ReportSummaryAggregate,
): void {
  acc.sum += value
  acc.count += 1
  acc.min = acc.min === null ? value : Math.min(acc.min, value)
  acc.max = acc.max === null ? value : Math.max(acc.max, value)
}

function mergeAccumulators(target: MeasureAccumulator, source: MeasureAccumulator): void {
  target.sum += source.sum
  target.count += source.count
  if (source.min !== null) {
    target.min = target.min === null ? source.min : Math.min(target.min, source.min)
  }
  if (source.max !== null) {
    target.max = target.max === null ? source.max : Math.max(target.max, source.max)
  }
}

function finalizeAccumulator(
  acc: MeasureAccumulator,
  aggregate: ReportAggregate,
): number | null {
  if (acc.count === 0 && aggregate !== 'count') return null
  if (aggregate === 'count') return acc.count
  if (aggregate === 'avg') return acc.count > 0 ? acc.sum / acc.count : null
  if (aggregate === 'min') return acc.min
  if (aggregate === 'max') return acc.max
  return acc.sum
}

function resolveAggregate(
  acc: MeasureAccumulator | undefined,
  aggregate: ReportAggregate,
): number | null {
  if (!acc) return aggregate === 'count' ? 0 : null
  return finalizeAccumulator(acc, aggregate)
}

function pushMeasureCell(
  line: Array<string | number | null>,
  numberFormats: Array<{ r: number; c: number; z: string }>,
  rowIndex: number,
  value: number | null,
  measure: ReportPivotValue,
  numberDisplayByField: Record<string, NumberDisplayOptions>,
): void {
  const colIndex = line.length
  if (value === null) {
    line.push(null)
    return
  }
  line.push(value)
  numberFormats.push({
    r: rowIndex,
    c: colIndex,
    z: excelNumberFormat(measure, numberDisplayByField[measure.field]),
  })
}

/** Excel format code — currency via cell format, value stays numeric. */
function excelNumberFormat(
  measure: ReportPivotValue,
  display?: NumberDisplayOptions | null,
): string {
  if (measure.aggregate === 'count') return '#,##0'
  const places =
    typeof display?.decimalPlaces === 'number'
      ? Math.min(38, Math.max(0, Math.trunc(display.decimalPlaces)))
      : 2
  const decimals = places > 0 ? `.${'0'.repeat(places)}` : ''
  const base = `#,##0${decimals}`

  if (display?.useOrgCurrency) {
    const symbol = escapeExcelFormatLiteral(getOrgCurrencySymbol())
    return `"${symbol}"${base}`
  }
  if (display?.prefix) {
    return `"${escapeExcelFormatLiteral(display.prefix)}"${base}`
  }
  if (display?.suffix) {
    return `${base}"${escapeExcelFormatLiteral(display.suffix)}"`
  }
  return base
}

function escapeExcelFormatLiteral(value: string): string {
  return value.replace(/"/g, '""')
}

function toNumeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.value === 'number' && Number.isFinite(record.value)) {
      return record.value
    }
  }
  return null
}

function cellMapKey(rowKey: string, colKey: string): string {
  return `${rowKey}\u0002${colKey}`
}

function sortKeyList(keys: string[], sorts: Array<'asc' | 'desc'>): string[] {
  return [...keys].sort((a, b) => {
    const aParts = a.split('\u0001')
    const bParts = b.split('\u0001')
    const len = Math.max(aParts.length, bParts.length, sorts.length)
    for (let i = 0; i < len; i += 1) {
      const left = aParts[i] ?? ''
      const right = bParts[i] ?? ''
      const cmp = left.localeCompare(right, undefined, { numeric: true })
      if (cmp !== 0) {
        const sort = sorts[i] ?? 'asc'
        return sort === 'desc' ? -cmp : cmp
      }
    }
    return 0
  })
}

function padLabels(labels: string[], width: number): string[] {
  const next = [...labels]
  while (next.length < width) next.push('')
  return next.slice(0, width)
}

function appendFilteredByBlock(
  aoa: Array<Array<string | number | null>>,
  filterLines: string[],
): void {
  if (filterLines.length === 0) return
  aoa.push(['Filtered By'])
  for (const line of filterLines) {
    aoa.push([line])
  }
  aoa.push([])
}

function formatAsOfTimestamp(): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date())
  } catch {
    return new Date().toISOString()
  }
}

function sanitizeSheetName(value: string): string {
  const cleaned = value
    .replace(/[\\/?*\[\]:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
  return cleaned || 'Report'
}
