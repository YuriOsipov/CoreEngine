import { query } from '../db/pool.js'
import { loadM2ORelations, loadO2MRelations } from '../adapters/records/relations.js'
import { parseOp } from './computedTemplate.js'
import {
  extractFormulaTemplate,
  parseRollupConfig,
  resolveComputeMode,
  type RollupConfig,
} from './fieldMeta.js'

function clampSensitivity(value: unknown): number {
  const num = Math.trunc(Number(value))
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.min(num, 2)
}

function entityKey(entity: string): string {
  return String(entity || '').trim().toLowerCase()
}

/** Stored field sensitivities (not yet elevated for computed inheritance). */
export async function loadStoredSensitivityByEntity(): Promise<
  Map<string, Map<string, number>>
> {
  const byEntity = new Map<string, Map<string, number>>()
  const rows = await query<{
    entity_api_name: string
    field_api_name: string
    sensitivity: number
  }>(
    `SELECT e.api_name AS entity_api_name,
            f.api_name AS field_api_name,
            f.sensitivity
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE f.sensitivity > 0
       AND e.deleted_at IS NULL`,
  )
  for (const row of rows) {
    const key = entityKey(row.entity_api_name)
    const fields = byEntity.get(key) ?? new Map<string, number>()
    fields.set(row.field_api_name, clampSensitivity(row.sensitivity))
    byEntity.set(key, fields)
  }
  return byEntity
}

/** Function / keyword tokens that are not field paths. */
const EXPRESSION_NON_FIELD_TOKENS = new Set([
  'INT',
  'FLOAT',
  'STRING',
  'DATE',
  'SLUG',
  'CURRENCY',
  'ABS',
  'SQRT',
  'SUM',
  'AVERAGE',
  'CEIL',
  'FLOOR',
  'ROUND',
  'EXP',
  'LOG',
  'MAX',
  'MIN',
  'NULL',
  'NOT_NULL',
  'NOT',
  'LENGTH',
  'FIRST',
  'LAST',
  'JSON_PARSE',
  'JSON_STRINGIFY',
  'SUBTRACT',
  'MULTIPLY',
  'DIVIDE',
  'REMAINDER',
  'DATE_ADD_DAYS',
  'POWER',
  'CONCAT',
  'EQUAL',
  'NOT_EQUAL',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'AND',
  'OR',
  'JSON_GET',
  'IF',
  'IFS',
  'FIND',
  'FIND_BETWEEN',
  'TRUE',
  'FALSE',
  'FN',
])

function parseCallArgs(expr: string): string[] | null {
  const op = parseOp(expr)
  if (op) return op.args
  // Same shape as parseOp, but allow lowercase function names from Setup UI.
  const match = expr.trim().match(/^([a-zA-Z_][\w]*)\((.+)\)$/)
  if (!match) return null
  return parseOp(`FN(${match[2]})`)?.args ?? null
}

/**
 * Recursively collect field paths an expression reads (mirrors parseExpression).
 * Covers bare paths, nested calls, and arithmetic fallbacks like `a + b`.
 */
export function collectExpressionSourcePaths(expr: string): string[] {
  const out = new Set<string>()
  collectExpressionSourcePathsInto(expr, out)
  return [...out]
}

function collectExpressionSourcePathsInto(
  expr: string,
  out: Set<string>,
): void {
  const exp = String(expr || '').trim()
  if (!exp || exp.startsWith('$')) return
  if (exp.startsWith('"') && exp.endsWith('"')) return
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(exp)) return

  if (/^[a-zA-Z_][\w.]*$/.test(exp)) {
    if (!EXPRESSION_NON_FIELD_TOKENS.has(exp.toUpperCase())) out.add(exp)
    return
  }

  const args = parseCallArgs(exp)
  if (args) {
    for (const arg of args) collectExpressionSourcePathsInto(arg, out)
    return
  }

  // Exotic / arithmetic expressions: harvest identifier and dotted paths.
  for (const pathMatch of exp.matchAll(
    /\b([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\b/g,
  )) {
    const token = pathMatch[1]!
    if (EXPRESSION_NON_FIELD_TOKENS.has(token.toUpperCase())) continue
    if (token.startsWith('$')) continue
    out.add(token)
  }
}

/**
 * Field paths a formula template reads (same-record or `m2o.field` hops).
 * Used to inherit sensitivity from sources onto the computed field.
 */
export function collectComputedSourcePaths(template: string): string[] {
  const out = new Set<string>()
  for (const match of String(template || '').matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    for (const path of collectExpressionSourcePaths(match[1] ?? '')) {
      out.add(path)
    }
  }
  return [...out]
}

async function relatedEntityFor(
  entity: string,
  field: string,
): Promise<string | null> {
  const m2o = (await loadM2ORelations(entity)).find((rel) => rel.fieldApiName === field)
  if (m2o?.relatedEntityApiName) return m2o.relatedEntityApiName
  const o2m = (await loadO2MRelations(entity)).find((rel) => rel.fieldApiName === field)
  return o2m?.junctionEntityApiName ?? null
}

/** Max stored sensitivity along a dotted path (leaf + intermediate FKs). */
export async function pathMaxSensitivity(
  entity: string,
  path: string,
  sensitivityByEntity: Map<string, Map<string, number>>,
): Promise<number> {
  const segments = String(path || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!segments.length) return 0
  let current = entity
  let max = 0
  for (let index = 0; index < segments.length; index += 1) {
    const field = segments[index]!
    const tier = sensitivityByEntity.get(entityKey(current))?.get(field) ?? 0
    max = Math.max(max, clampSensitivity(tier))
    if (index === segments.length - 1) return max
    const next = await relatedEntityFor(current, field)
    if (!next) return max
    current = next
  }
  return max
}

export async function rollupSourceSensitivity(
  rollup: RollupConfig,
  sensitivityByEntity: Map<string, Map<string, number>>,
): Promise<number> {
  const valueField = String(rollup.valueField || '').trim()
  if (!valueField || valueField === '*') return 0
  return pathMaxSensitivity(rollup.childEntity, valueField, sensitivityByEntity)
}

export async function formulaSourceSensitivity(
  entity: string,
  template: string,
  sensitivityByEntity: Map<string, Map<string, number>>,
): Promise<number> {
  let max = 0
  for (const path of collectComputedSourcePaths(template)) {
    max = Math.max(
      max,
      await pathMaxSensitivity(entity, path, sensitivityByEntity),
    )
  }
  return max
}

/**
 * Minimum sensitivity a formula/rollup field must carry given its sources.
 * Returns 0 for non-computed fields or when sources are open.
 */
export async function requiredComputedSensitivity(
  entityApiName: string,
  options: Record<string, unknown>,
  fieldInterface: string,
  sensitivityByEntity: Map<string, Map<string, number>>,
): Promise<number> {
  const mode = resolveComputeMode(options, fieldInterface)
  if (mode === 'formula') {
    const template = extractFormulaTemplate(options)
    if (!template) return 0
    return formulaSourceSensitivity(
      entityApiName,
      template,
      sensitivityByEntity,
    )
  }
  if (mode === 'rollup') {
    const rollup = parseRollupConfig(options)
    if (!rollup) return 0
    return rollupSourceSensitivity(rollup, sensitivityByEntity)
  }
  return 0
}

/**
 * Raise formula/rollup entries in `byEntity` to max(own, sources). Fixed-point
 * so formula→formula chains inherit correctly.
 */
export async function elevateComputedSensitivities(
  byEntity: Map<string, Map<string, number>>,
  computed: Array<{
    entity: string
    apiName: string
    options: Record<string, unknown>
    fieldInterface: string
  }>,
): Promise<void> {
  if (!computed.length) return
  let changed = true
  let passes = 0
  while (changed && passes < 8) {
    changed = false
    passes += 1
    for (const field of computed) {
      const required = await requiredComputedSensitivity(
        field.entity,
        field.options,
        field.fieldInterface,
        byEntity,
      )
      if (required <= 0) continue
      const key = entityKey(field.entity)
      const fields = byEntity.get(key) ?? new Map<string, number>()
      const current = fields.get(field.apiName) ?? 0
      if (required <= current) continue
      fields.set(field.apiName, required)
      byEntity.set(key, fields)
      changed = true
    }
  }
}
