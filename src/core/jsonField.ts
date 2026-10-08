import type { FieldDefinition } from '@/interfaces'
import { isAddressFieldDefinition } from '@/core/addressField'

export type JsonListColumnType = 'string' | 'number' | 'boolean'

export interface JsonListColumn {
  name: string
  type: JsonListColumnType
}

export type JsonListRow = Record<string, unknown>

function normalizeSpecial(
  special: string[] | string | null | undefined,
): string[] {
  if (!special) return []
  if (Array.isArray(special)) return special
  return [special]
}

function normalizeColumnType(raw: unknown): JsonListColumnType {
  const value = String(raw ?? '')
    .toLowerCase()
    .trim()
  if (value === 'number' || value === 'integer' || value === 'float') return 'number'
  if (value === 'boolean' || value === 'bool') return 'boolean'
  return 'string'
}

export function isJsonListFieldDefinition(field: FieldDefinition): boolean {
  const special = normalizeSpecial(field.meta?.special)
  if (special.includes('json-list')) return true

  const iface = (field.meta?.interface ?? '').toLowerCase()
  return iface === 'json-list'
}

export function isJsonCodeFieldDefinition(field: FieldDefinition): boolean {
  if (isAddressFieldDefinition(field) || isJsonListFieldDefinition(field)) {
    return false
  }
  if (field.type !== 'json') return false

  const iface = (field.meta?.interface ?? '').toLowerCase()
  return iface === 'input-code' || iface.includes('input-code') || iface === 'json'
}

export function getJsonListColumns(field: FieldDefinition): JsonListColumn[] {
  const raw = field.meta?.options?.columns
  if (!Array.isArray(raw)) return []

  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      return {
        name,
        type: normalizeColumnType(item.type),
      }
    })
    .filter((col) => Boolean(col.name))
}

export function createEmptyJsonListRow(columns: JsonListColumn[]): JsonListRow {
  const row: JsonListRow = {}
  for (const col of columns) {
    if (col.type === 'number') row[col.name] = null
    else if (col.type === 'boolean') row[col.name] = false
    else row[col.name] = ''
  }
  return row
}

function coerceCellValue(raw: unknown, type: JsonListColumnType): unknown {
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true' || raw === 1 || raw === '1') return true
    if (raw === 'false' || raw === 0 || raw === '0') return false
    return Boolean(raw)
  }
  if (type === 'number') {
    if (raw === null || raw === undefined || raw === '') return null
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (raw === null || raw === undefined) return ''
  return String(raw)
}

export function normalizeJsonListValue(
  value: unknown,
  columns: JsonListColumn[],
): JsonListRow[] {
  if (!Array.isArray(value)) return []

  return value.map((item) => {
    const source =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {}
    const row: JsonListRow = {}
    for (const col of columns) {
      row[col.name] = coerceCellValue(source[col.name], col.type)
    }
    return row
  })
}

/** Compact one-line summary for read-only / list views. */
export function formatJsonListSummary(
  value: unknown,
  columns: JsonListColumn[],
  emptyValue = '-',
): string {
  if (!Array.isArray(value) || value.length === 0) return emptyValue

  if (columns.length === 0) {
    try {
      const preview = JSON.stringify(value.slice(0, 3))
      return value.length > 3 ? `${preview.slice(0, -1)}, …]` : preview
    } catch {
      return `${value.length} row(s)`
    }
  }

  const rows = normalizeJsonListValue(value, columns)
  if (rows.length === 0) return emptyValue
  const names = columns.map((c) => c.name)
  const preview = rows
    .slice(0, 3)
    .map((row) =>
      names
        .map((name) => {
          const v = row[name]
          return v === null || v === undefined || v === '' ? '' : String(v)
        })
        .filter(Boolean)
        .join('–'),
    )
    .filter(Boolean)
  const suffix = rows.length > 3 ? ` (+${rows.length - 3})` : ''
  return preview.length > 0 ? `${preview.join('; ')}${suffix}` : `${rows.length} row(s)`
}

/** Compact display for raw JSON values. */
export function formatJsonCodeSummary(value: unknown, emptyValue = '-'): string {
  if (value === null || value === undefined) return emptyValue
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || emptyValue
  }
  try {
    return JSON.stringify(value)
  } catch {
    return emptyValue
  }
}

export function stringifyJsonCode(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

export function parseJsonCodeText(text: string): JsonParseResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: true, value: null }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON'
    return { ok: false, error: message }
  }
}
