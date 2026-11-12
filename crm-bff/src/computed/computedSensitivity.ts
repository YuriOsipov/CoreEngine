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

/**
 * Field paths a formula template reads (same-record or `m2o.field` hops).
 * Used to inherit sensitivity from sources onto the computed field.
 */
function collectArgsFromCall(expr: string): string[] {
  const op = parseOp(expr)
  if (op) return op.args
  // Same shape as parseOp, but allow lowercase function names from Setup UI.
  const match = expr.trim().match(/^([a-zA-Z_][\w]*)\((.+)\)$/)
  if (!match) return []
  return parseOp(`FN(${match[2]})`)?.args ?? []
}

export function collectComputedSourcePaths(template: string): string[] {
  const out = new Set<string>()
  for (const match of String(template || '').matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const expr = (match[1] ?? '').trim()
    if (!expr || expr.startsWith('$')) continue
    if (/^[a-zA-Z_][\w.]*$/.test(expr)) {
      out.add(expr)
      continue
    }
    for (const pathMatch of expr.matchAll(
      /\b([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+)\b/g,
    )) {
      out.add(pathMatch[1]!)
    }
    for (const arg of collectArgsFromCall(expr)) {
      const a = arg.trim()
      if (/^[a-zA-Z_][\w.]*$/.test(a) && !a.startsWith('$')) out.add(a)
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
