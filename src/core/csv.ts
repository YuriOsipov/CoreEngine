/** RFC4180-ish CSV helpers (UTF-8, optional BOM, quoted fields). */

export type CsvRow = Record<string, string>

export interface ParsedCsv {
  headers: string[]
  rows: CsvRow[]
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Parse a full CSV document into headers + row objects keyed by header. */
export function parseCsv(text: string): ParsedCsv {
  const normalized = stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const matrix = parseCsvMatrix(normalized)
  if (matrix.length === 0) {
    return { headers: [], rows: [] }
  }
  const headers = matrix[0].map((header, index) => {
    const trimmed = header.trim()
    return trimmed || `column_${index + 1}`
  })
  const rows: CsvRow[] = []
  for (let i = 1; i < matrix.length; i += 1) {
    const cells = matrix[i]
    if (cells.every((cell) => cell.trim() === '')) continue
    const row: CsvRow = {}
    for (let c = 0; c < headers.length; c += 1) {
      row[headers[c]] = cells[c] ?? ''
    }
    rows.push(row)
  }
  return { headers, rows }
}

function parseCsvMatrix(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      cell += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(cell)
      cell = ''
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i += 1
      continue
    }
    cell += ch
    i += 1
  }

  if (cell.length > 0 || row.length > 0 || text.endsWith(',')) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

export function serializeCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(escapeCsvCell).join(',')]
  for (const row of rows) {
    lines.push(
      headers
        .map((header) => escapeCsvCell(formatCsvValue(row[header])))
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** Trigger a browser download for a CSV string. */
export function downloadCsv(filename: string, csvText: string): void {
  const blob = new Blob([`\uFEFF${csvText}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
