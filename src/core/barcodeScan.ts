import type { BarcodeScanMatchMode, BarcodeScanSettings } from '@/interfaces'
import { bridgeReadItem, bridgeReadItemsPage, bridgeUpdateItem } from '@/core/graphql/itemsBridge'
import {
  evaluateComputedTemplate,
  extractTemplateFieldRefs,
  findValueByPath,
  parseExpression,
} from '@/core/computedTemplate'
import { getCachedCollectionFields } from '@/modules/entities/services/collectionSchema'

const NUMERIC_FIELD_TYPES = new Set([
  'integer',
  'bigInteger',
  'float',
  'decimal',
])

export function normalizeBarcodeScanSettings(
  value: BarcodeScanSettings | null | undefined,
): BarcodeScanSettings | null {
  if (!value || typeof value !== 'object') return null
  const field = String(value.field ?? '').trim()
  if (!value.enabled || !field) return null

  const matchMode = normalizeMatchMode(value.matchMode)
  const updateField = String(value.updateField ?? '').trim() || null
  const setFields =
    value.setFields && typeof value.setFields === 'object' && !Array.isArray(value.setFields)
      ? { ...value.setFields }
      : null

  return {
    enabled: true,
    field,
    matchMode,
    ...(value.defaultScanModeOn ? { defaultScanModeOn: true } : {}),
    ...(setFields && Object.keys(setFields).length ? { setFields } : {}),
    ...(updateField ? { updateField } : {}),
    ...(value.confirmUpdate ? { confirmUpdate: true } : {}),
  }
}

function normalizeMatchMode(
  value: BarcodeScanMatchMode | undefined,
): BarcodeScanMatchMode {
  if (value === 'open' || value === 'filter' || value === 'open-or-filter') {
    return value
  }
  return 'open-or-filter'
}

export function isBarcodeScanEnabled(
  settings: BarcodeScanSettings | null | undefined,
): boolean {
  return Boolean(normalizeBarcodeScanSettings(settings))
}

/**
 * Resolve setFields against the matched record.
 * Supports `$NOW` / `$NULL` / `$SCAN`, `{{SUM(base_price, 2)}}` templates,
 * and infix math like `base_price + 2` or `base_price + group`.
 */
export function resolveBarcodeSetFields(
  setFields: Record<string, unknown> | null | undefined,
  scanCode: string,
  record: Record<string, unknown> = {},
): Record<string, unknown> {
  if (!setFields) return {}
  const out: Record<string, unknown> = {}
  const nowIso = new Date().toISOString()
  const context: Record<string, unknown> = {
    ...record,
    $SCAN: scanCode,
    $NOW: nowIso,
  }
  for (const [field, raw] of Object.entries(setFields)) {
    const key = field.trim()
    if (!key) continue
    out[key] = resolveBarcodeFieldToken(raw, scanCode, nowIso, context)
  }
  return out
}

/** Field paths referenced by setFields expressions (for fetch). */
export function collectBarcodeSetFieldPaths(
  setFields: Record<string, unknown> | null | undefined,
): string[] {
  if (!setFields) return []
  const refs = new Set<string>()
  for (const [target, raw] of Object.entries(setFields)) {
    const targetField = target.trim()
    if (targetField) refs.add(targetField)
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    for (const path of extractExpressionOperandPaths(trimmed)) {
      refs.add(path)
    }
  }
  return Array.from(refs)
}

function extractExpressionOperandPaths(expression: string): string[] {
  const trimmed = expression.trim()
  if (!trimmed) return []

  let normalized = trimmed
  if (!trimmed.includes('{{')) {
    const infix = normalizeInfixExpression(trimmed)
    if (infix) normalized = `{{${infix}}}`
    else if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(trimmed)) return [trimmed]
    else return extractTemplateFieldRefs(`{{${trimmed}}}`)
  }

  const paths = new Set<string>()
  for (const match of normalized.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    collectOperandPaths(match[1], paths)
  }
  // Also keep top-level roots for GraphQL selection compatibility.
  for (const ref of extractTemplateFieldRefs(normalized)) paths.add(ref)
  return Array.from(paths)
}

function collectOperandPaths(expression: string, refs: Set<string>): void {
  const exp = expression.trim()
  if (!exp || (exp.startsWith('"') && exp.endsWith('"'))) return
  if (!Number.isNaN(parseFloat(exp)) && /^-?\d/.test(exp)) return

  const opMatch = exp.match(/^([A-Z_]+)\((.+)\)$/)
  if (opMatch) {
    // Reuse template parser for nested args when possible.
    const fromTemplate = extractTemplateFieldRefs(`{{${exp}}}`)
    for (const ref of fromTemplate) refs.add(ref)
    // Capture dotted paths inside args: SUM(base_price, group.markup)
    const inner = opMatch[2]
    for (const part of inner.split(',')) {
      const token = part.trim()
      if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token)) refs.add(token)
    }
    return
  }

  if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(exp)) {
    refs.add(exp)
  }
}

/**
 * Convert `base_price + 2` / `base_price - group` into template ops.
 * Returns null when the string is not infix arithmetic.
 */
function normalizeInfixExpression(expression: string): string | null {
  const trimmed = expression.trim()
  if (!trimmed || trimmed.includes('{{') || /^[A-Z_]+\(/.test(trimmed)) {
    return null
  }
  // Split on + - * / while ignoring leading sign on the right operand.
  const match = trimmed.match(
    /^(.+?)\s*([+\-*/])\s*([+\-]?\s*.+)$/,
  )
  if (!match) return null
  const left = match[1].trim()
  const op = match[2]
  const right = match[3].replace(/\s+/g, '')
  if (!left || !right) return null
  // Avoid treating plain numbers / bare paths as infix.
  if (!/^[A-Za-z_]/.test(left) && Number.isNaN(Number(left))) return null

  const opName =
    op === '+'
      ? 'SUM'
      : op === '-'
        ? 'SUBTRACT'
        : op === '*'
          ? 'MULTIPLY'
          : 'DIVIDE'
  return `${opName}(${left}, ${right})`
}

function resolveBarcodeFieldToken(
  raw: unknown,
  scanCode: string,
  nowIso: string,
  context: Record<string, unknown>,
): unknown {
  if (raw === null) return null
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim()
  if (trimmed === '$NULL' || trimmed === '{{$NULL}}') return null
  if (trimmed === '$NOW' || trimmed === '{{$NOW}}') return nowIso
  if (trimmed === '$SCAN' || trimmed === '{{$SCAN}}') return scanCode

  // Explicit computed-template dialect.
  if (trimmed.includes('{{')) {
    return evaluateComputedTemplate(trimmed, context)
  }

  // Infix: base_price + 2, base_price + group, base_price + group.markup
  const infix = normalizeInfixExpression(trimmed)
  if (infix) {
    return parseExpression(infix, context)
  }

  // Bare path copy from the matched record.
  if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(trimmed)) {
    const resolved = findValueByPath(context, trimmed)
    if (resolved.found) return resolved.value
  }

  return raw
}

export function buildBarcodeEqFilter(
  field: string,
  code: string,
  fieldType?: string | null,
): Record<string, unknown> {
  const value = coerceBarcodeLookupValue(code, fieldType)
  return { [field]: { _eq: value } }
}

function coerceBarcodeLookupValue(
  code: string,
  fieldType?: string | null,
): string | number {
  if (!fieldType || !NUMERIC_FIELD_TYPES.has(fieldType)) return code
  const numeric = Number(code)
  return Number.isNaN(numeric) ? code : numeric
}

export async function resolveBarcodeFieldType(
  collection: string,
  field: string,
): Promise<string | null> {
  try {
    const fields = await getCachedCollectionFields(collection)
    const match = fields.find((entry) => entry.field === field)
    return match?.type ?? null
  } catch {
    return null
  }
}

export interface BarcodeLookupResult {
  records: Record<string, unknown>[]
  totalCount: number
  filter: Record<string, unknown>
}

export async function lookupRecordsByBarcode(options: {
  collection: string
  field: string
  code: string
  /** Extra AND filters (e.g. parent FK for related lists). */
  extraFilter?: Record<string, unknown> | null
  limit?: number
  fields?: string[]
}): Promise<BarcodeLookupResult> {
  const code = options.code.trim()
  const fieldType = await resolveBarcodeFieldType(options.collection, options.field)
  const eqFilter = buildBarcodeEqFilter(options.field, code, fieldType)
  const filter = options.extraFilter
    ? { _and: [options.extraFilter, eqFilter] }
    : eqFilter

  const page = await bridgeReadItemsPage(options.collection, {
    filter,
    fields: options.fields ?? ['id', options.field],
    limit: options.limit ?? 25,
    offset: 0,
  })

  return {
    records: page.nodes,
    totalCount: page.totalCount,
    filter: eqFilter,
  }
}

export function buildBarcodeUpdatePayload(
  settings: BarcodeScanSettings,
  scanCode: string,
  updateValue: string,
  record: Record<string, unknown> = {},
): Record<string, unknown> {
  const payload = resolveBarcodeSetFields(settings.setFields, scanCode, record)
  const updateField = settings.updateField?.trim()
  if (updateField && updateValue.trim() !== '') {
    const trimmed = updateValue.trim()
    // Allow the Value input to use the same expression language.
    payload[updateField] = resolveBarcodeFieldToken(
      trimmed,
      scanCode,
      new Date().toISOString(),
      { ...record, $SCAN: scanCode },
    )
  }
  return payload
}

export function barcodeScanNeedsUpdate(
  settings: BarcodeScanSettings,
  updateValue: string,
): boolean {
  const hasSetFields = Boolean(
    settings.setFields && Object.keys(settings.setFields).length > 0,
  )
  const updateField = settings.updateField?.trim()
  const hasUpdateValue = Boolean(updateField && updateValue.trim() !== '')
  return hasSetFields || hasUpdateValue
}

export async function updateRecordFromBarcodeScan(options: {
  collection: string
  id: string | number
  settings: BarcodeScanSettings
  scanCode: string
  updateValue: string
  /** Matched row when already loaded; otherwise re-fetched for expressions. */
  record?: Record<string, unknown> | null
}): Promise<Record<string, unknown>> {
  const expressionPaths = collectBarcodeSetFieldPaths(options.settings.setFields)
  const updateField = options.settings.updateField?.trim()
  if (updateField && options.updateValue.trim()) {
    const fromValue = collectBarcodeSetFieldPaths({
      [updateField]: options.updateValue.trim(),
    })
    expressionPaths.push(...fromValue)
  }

  const fetchFields = Array.from(
    new Set(['id', ...expressionPaths, ...(updateField ? [updateField] : [])]),
  )

  // Always re-fetch when expressions need record values so nested paths resolve.
  const record =
    expressionPaths.length > 0
      ? await bridgeReadItem(options.collection, options.id, {
          fields: fetchFields,
        })
      : (options.record ??
        (await bridgeReadItem(options.collection, options.id, {
          fields: fetchFields,
        })))

  const payload = buildBarcodeUpdatePayload(
    options.settings,
    options.scanCode,
    options.updateValue,
    record,
  )
  if (Object.keys(payload).length === 0) {
    return {}
  }
  return bridgeUpdateItem(options.collection, options.id, payload, {
    fields: ['id'],
  })
}

export function mergeRawListFilters(
  ...filters: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> | null {
  const active = filters.filter(
    (filter): filter is Record<string, unknown> =>
      Boolean(filter && Object.keys(filter).length > 0),
  )
  if (active.length === 0) return null
  if (active.length === 1) return active[0]!
  return { _and: active }
}
