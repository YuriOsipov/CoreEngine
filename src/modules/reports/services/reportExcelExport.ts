import * as XLSX from 'xlsx'
import type { FieldDefinition } from '@/interfaces'
import { downloadCsv, serializeCsv } from '@/core/csv'
import { isNumericFieldDefinition } from '@/core/fieldHelpers'
import { getPathValue, type NumberDisplayOptions } from '@/modules/entities/utils/recordDisplay'
import { formatReportAggregateValue } from './reportCellDisplay'
import {
  formatTabularCell,
  orderRows,
} from './reportTabularRuntime'
import {
  reportFieldDisplayLabel,
  type ReportDefinition,
  type ReportFilterCondition,
} from './reportSettings'
import {
  buildPivotStyleSheetAoa,
  downloadPivotStyleXlsx,
  resolveExportPivotSettings,
} from './reportPivotExport'

export type ReportExportFormat = 'xls' | 'xlsx' | 'csv'

export interface ReportExcelMatrix {
  headers: string[]
  /** Source field paths aligned with headers. */
  fields: string[]
  rows: string[][]
}

/**
 * Flat Details Only matrix: one row per source record, group + column fields filled
 * (no indented blank group cells from the on-screen outline).
 */
export function buildReportDetailsOnlyMatrix(
  report: Pick<ReportDefinition, 'tabular'>,
  rows: Record<string, unknown>[],
  fieldLabels: Record<string, string> = {},
  fieldDefinitions: Map<string, FieldDefinition> = new Map(),
  numberDisplayByField: Record<string, NumberDisplayOptions> = {},
): ReportExcelMatrix {
  const tabular = report.tabular
  const fields: string[] = [
    ...tabular.groupRows.map((group) => group.field),
    ...tabular.columns.map((column) => column.field),
  ]
  const headers = fields.map((field) => {
    const base = fieldLabels[field] || field
    const column = tabular.columns.find((entry) => entry.field === field)
    if (!column) return base
    const summaries = column.summaries ?? []
    if (summaries.length === 1) {
      return `${summaryHeader(summaries[0]!)} ${base}`
    }
    if (summaries.length > 1) {
      return `${base} (${summaries.map(summaryHeader).join(', ')})`
    }
    return base
  })

  const ordered = orderRows(rows, tabular.groupRows, tabular.columns)
  const matrixRows = ordered.map((row) =>
    fields.map((field) => formatExportCell(row, field, fieldDefinitions, numberDisplayByField)),
  )

  return { headers, fields, rows: matrixRows }
}

function formatExportCell(
  row: Record<string, unknown>,
  field: string,
  fieldDefinitions: Map<string, FieldDefinition>,
  numberDisplayByField: Record<string, NumberDisplayOptions>,
): string {
  const definition = fieldDefinitions.get(field)
  const numberDisplay = numberDisplayByField[field]
  if (numberDisplay && isNumericFieldDefinition(definition)) {
    const raw = getPathValue(row, field)
    return (
      formatReportAggregateValue(raw, 'sum', numberDisplay) ||
      formatTabularCell(row, field, definition)
    )
  }
  return formatTabularCell(row, field, definition)
}

function summaryHeader(aggregate: string): string {
  if (aggregate === 'avg') return 'Avg of'
  if (aggregate === 'median') return 'Median of'
  if (aggregate === 'sum') return 'Sum of'
  if (aggregate === 'min') return 'Min of'
  if (aggregate === 'max') return 'Max of'
  return aggregate
}

/** Salesforce-style HTML table that Excel opens as a workbook. */
export function serializeReportExcelHtml(headers: string[], rows: string[][]): string {
  const th = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')
  const body = rows
    .map((row) => {
      const cells = headers.map((_, index) => {
        const value = row[index] ?? ''
        return `<td style="vnd.ms-excel.numberformat:@">${escapeHtml(value)}</td>`
      })
      return `<tr>${cells.join('')}</tr>`
    })
    .join('')

  return (
    `<html><head>` +
    `<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">` +
    `</head><body>` +
    `<table><tr>${th}</tr>${body}</table>` +
    `</body></html>`
  )
}

export function downloadReportExcel(filename: string, html: string): void {
  const safeName = filename.toLowerCase().endsWith('.xls')
    ? filename
    : `${stripExportExtension(filename)}.xls`
  downloadBlob(safeName, new Blob([`\uFEFF${html}`], {
    type: 'application/vnd.ms-excel;charset=utf-8',
  }))
}

export function downloadReportXlsx(
  filename: string,
  matrix: ReportExcelMatrix,
  options: {
    title?: string
    filterLines?: string[]
    sheetName?: string
  } = {},
): void {
  const safeName = filename.toLowerCase().endsWith('.xlsx')
    ? filename
    : `${stripExportExtension(filename)}.xlsx`
  const preface: string[][] = []
  if (options.title) {
    preface.push([options.title])
    preface.push([`As of ${formatExportTimestamp()}`])
    preface.push([])
  }
  if (options.filterLines && options.filterLines.length > 0) {
    preface.push(['Filtered By'])
    for (const line of options.filterLines) preface.push([line])
    preface.push([])
  }
  const sheetRows = [...preface, matrix.headers, ...matrix.rows]
  const sheet = XLSX.utils.aoa_to_sheet(sheetRows)
  // Force text cells so Excel does not rewrite phone/IDs (SF-style intent).
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = sheet[addr]
      if (!cell) continue
      cell.t = 's'
      cell.v = String(cell.v ?? '')
      cell.z = '@'
    }
  }
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    sheet,
    sanitizeSheetName(options.sheetName || options.title || 'Details'),
  )
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  downloadBlob(
    safeName,
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  )
}

/** Human-readable filter lines for Excel "Filtered By" (SF-style). */
export function buildReportExportFilterLines(
  conditions: ReportFilterCondition[],
  fieldLabels: Record<string, string> = {},
): string[] {
  const lines: string[] = []
  for (const condition of conditions) {
    const field =
      fieldLabels[condition.field] || reportFieldDisplayLabel(condition.field)
    const operator = exportOperatorLabel(condition.operator)
    if (condition.operator === '_null' || condition.operator === '_nnull') {
      lines.push(`${field} ${operator}`)
      continue
    }
    const value = formatExportFilterValue(condition.value)
    if (!value) continue
    lines.push(`${field} ${operator} ${value}`)
  }
  return lines
}

export function downloadReportCsv(filename: string, matrix: ReportExcelMatrix): void {
  const safeName = filename.toLowerCase().endsWith('.csv')
    ? filename
    : `${stripExportExtension(filename)}.csv`
  const recordRows = matrix.rows.map((row) => {
    const record: Record<string, string> = {}
    for (let i = 0; i < matrix.headers.length; i += 1) {
      record[matrix.headers[i]!] = row[i] ?? ''
    }
    return record
  })
  downloadCsv(safeName, serializeCsv(matrix.headers, recordRows))
}

export function exportReportDetailsOnly(
  report: Pick<
    ReportDefinition,
    'tabular' | 'name' | 'title' | 'type' | 'pivot' | 'conditions'
  >,
  rows: Record<string, unknown>[],
  format: ReportExportFormat,
  fieldLabels: Record<string, string> = {},
  fieldDefinitions: Map<string, FieldDefinition> = new Map(),
  numberDisplayByField: Record<string, NumberDisplayOptions> = {},
  filterLines: string[] = [],
): {
  filename: string
  rowCount: number
  format: ReportExportFormat
  style: 'details' | 'pivot'
} {
  const base =
    sanitizeFilename(report.name || report.title || 'report') || 'report'
  const resolvedFilterLines =
    filterLines.length > 0
      ? filterLines
      : buildReportExportFilterLines(report.conditions ?? [], fieldLabels)

  // Summary / matrix reports → SF pivot-style XLSX only.
  if (format === 'xlsx') {
    const pivot = resolveExportPivotSettings(report)
    if (pivot) {
      const sheet = buildPivotStyleSheetAoa(
        report,
        pivot,
        rows,
        fieldLabels,
        numberDisplayByField,
        resolvedFilterLines,
      )
      const filename = `${base}.xlsx`
      downloadPivotStyleXlsx(filename, sheet)
      return {
        filename,
        rowCount: sheet.dataRowCount,
        format,
        style: 'pivot',
      }
    }
  }

  const matrix = buildReportDetailsOnlyMatrix(
    report,
    rows,
    fieldLabels,
    fieldDefinitions,
    numberDisplayByField,
  )
  const filename = `${base}-details.${format}`

  if (format === 'csv') {
    downloadReportCsv(filename, matrix)
  } else if (format === 'xlsx') {
    downloadReportXlsx(filename, matrix, {
      title: report.title || report.name || 'Report',
      filterLines: resolvedFilterLines,
      sheetName: report.title || report.name || 'Details',
    })
  } else {
    downloadReportExcel(filename, serializeReportExcelHtml(matrix.headers, matrix.rows))
  }

  return { filename, rowCount: matrix.rows.length, format, style: 'details' }
}

/** @deprecated Prefer exportReportDetailsOnly(..., 'xls') */
export function exportReportDetailsOnlyExcel(
  report: Pick<
    ReportDefinition,
    'tabular' | 'name' | 'title' | 'type' | 'pivot' | 'conditions'
  >,
  rows: Record<string, unknown>[],
  fieldLabels: Record<string, string> = {},
  fieldDefinitions: Map<string, FieldDefinition> = new Map(),
  numberDisplayByField: Record<string, NumberDisplayOptions> = {},
): { filename: string; rowCount: number } {
  return exportReportDetailsOnly(
    report,
    rows,
    'xls',
    fieldLabels,
    fieldDefinitions,
    numberDisplayByField,
  )
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function stripExportExtension(filename: string): string {
  return filename.replace(/\.(xlsx|xls|csv)$/i, '')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120)
}

function sanitizeSheetName(value: string): string {
  const cleaned = value
    .replace(/[\\/?*\[\]:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
  return cleaned || 'Details'
}

function formatExportTimestamp(): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date())
  } catch {
    return new Date().toISOString()
  }
}

function exportOperatorLabel(operator: string): string {
  switch (operator) {
    case '_eq':
      return 'Equals'
    case '_neq':
      return 'Not equals'
    case '_contains':
      return 'Contains'
    case '_gt':
      return 'Greater than'
    case '_gte':
      return 'Greater or equal'
    case '_lt':
      return 'Less than'
    case '_lte':
      return 'Less or equal'
    case '_null':
      return 'Is empty'
    case '_nnull':
      return 'Is not empty'
    case '_between':
      return 'Date to date'
    default:
      return operator
  }
}

function formatExportFilterValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toLocaleString()
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatExportFilterValue(entry))
      .filter(Boolean)
      .join(' – ')
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record.label != null && String(record.label).trim()) return String(record.label).trim()
    if (record.name != null && String(record.name).trim()) return String(record.name).trim()
    if (record.id != null && String(record.id).trim()) return String(record.id).trim()
  }
  return String(value)
}
