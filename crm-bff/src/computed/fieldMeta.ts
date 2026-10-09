import { query } from '../db/pool.js'
import { resolveCanonicalEntityApiName } from '../adapters/records/entityName.js'

export type ComputeMode = 'none' | 'formula' | 'rollup' | 'autoNumber'

export type RollupOp = 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX'

export interface RollupConfig {
  childEntity: string
  parentField: string
  valueField: string
  op: RollupOp
  filter?: Record<string, unknown> | null
  /**
   * Virtual (true): compute on read, no stored column.
   * Physical (false): store on parent, refresh on child writes.
   * Undefined: resolved from field type when loading (ALIAS → virtual).
   */
  live?: boolean
}

export function isLiveRollup(rollup: RollupConfig): boolean {
  return rollup.live === true
}

export interface RegistryFieldMeta {
  id: string
  apiName: string
  fieldType: string
  interface: string
  readonly: boolean
  options: Record<string, unknown>
}

export interface FormulaFieldMeta {
  apiName: string
  template: string
}

export interface RollupFieldMeta {
  parentEntity: string
  apiName: string
  rollup: RollupConfig
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function isRelationDisplayInterface(iface: string): boolean {
  const lower = iface.toLowerCase()
  return (
    lower.includes('m2o') ||
    lower.includes('m2m') ||
    lower.includes('o2m') ||
    lower.includes('m2a') ||
    lower === 'file' ||
    lower === 'files' ||
    lower.includes('file-image') ||
    lower.includes('select-dropdown-m2o') ||
    lower.includes('list-o2m') ||
    lower.includes('list-m2m') ||
    lower.includes('list-m2a')
  )
}

function readComputeTemplate(options: Record<string, unknown>): string | null {
  for (const key of ['formula', 'expression', 'compute']) {
    const value = options[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function readTemplate(options: Record<string, unknown>): string | null {
  const compute = readComputeTemplate(options)
  if (compute) return compute
  const template = options.template
  if (typeof template === 'string' && template.trim()) return template.trim()
  return null
}

function normalizeOp(raw: unknown): RollupOp {
  const upper = String(raw || 'SUM').trim().toUpperCase()
  if (upper === 'COUNT' || upper === 'AVG' || upper === 'MIN' || upper === 'MAX') {
    return upper
  }
  return 'SUM'
}

export function parseRollupConfig(
  options: Record<string, unknown>,
): RollupConfig | null {
  const raw = options.rollup
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const childEntity = String(row.childEntity ?? row.child_entity ?? '').trim()
  const parentField = String(row.parentField ?? row.parent_field ?? '').trim()
  const valueField = String(row.valueField ?? row.value_field ?? '*').trim() || '*'
  if (!childEntity || !parentField) return null
  const filter =
    row.filter && typeof row.filter === 'object' && !Array.isArray(row.filter)
      ? (row.filter as Record<string, unknown>)
      : null
  let live: boolean | undefined
  if (row.live === true || row.live === 'true') live = true
  else if (row.live === false || row.live === 'false') live = false
  return {
    childEntity,
    parentField,
    valueField,
    op: normalizeOp(row.op ?? row.aggregate),
    filter,
    ...(live !== undefined ? { live } : {}),
  }
}

/** Resolve virtual vs physical when `live` was omitted from options. */
export function resolveRollupLive(
  rollup: RollupConfig,
  fieldType: string,
): boolean {
  if (rollup.live === true) return true
  if (rollup.live === false) return false
  return String(fieldType || '').toUpperCase() === 'ALIAS'
}

export function resolveComputeMode(
  options: Record<string, unknown>,
  iface: string,
): ComputeMode {
  const explicit = String(options.computeMode ?? options.compute_mode ?? '')
    .trim()
    .toLowerCase()
  if (
    explicit === 'formula' ||
    explicit === 'rollup' ||
    explicit === 'none' ||
    explicit === 'autonumber'
  ) {
    return explicit === 'autonumber' ? 'autoNumber' : explicit
  }
  if (
    options.autoNumber === true ||
    (options.autoNumber &&
      typeof options.autoNumber === 'object' &&
      !Array.isArray(options.autoNumber))
  ) {
    return 'autoNumber'
  }
  if (parseRollupConfig(options)) return 'rollup'
  // Directus M2O/M2M `options.template` is a display string, not a write formula.
  if (isRelationDisplayInterface(iface)) {
    return readComputeTemplate(options) ? 'formula' : 'none'
  }
  if (readTemplate(options)) return 'formula'
  const lower = iface.toLowerCase()
  if (
    lower.includes('calculated') ||
    lower.includes('formula') ||
    lower.includes('computed')
  ) {
    return 'formula'
  }
  return 'none'
}

export function extractFormulaTemplate(
  options: Record<string, unknown>,
): string | null {
  return readTemplate(options)
}

const entityFieldsCache = new Map<
  string,
  { value: RegistryFieldMeta[]; expiresAt: number }
>()
const ENTITY_FIELDS_TTL_MS = 15_000

let rollupIndexCache: { value: RollupFieldMeta[]; expiresAt: number } | null =
  null
const ROLLUP_INDEX_TTL_MS = 15_000

export function clearComputedFieldMetaCache(): void {
  entityFieldsCache.clear()
  rollupIndexCache = null
}

export async function loadEntityFieldMeta(
  entityApiName: string,
): Promise<RegistryFieldMeta[]> {
  const apiName = await resolveCanonicalEntityApiName(entityApiName)
  const cached = entityFieldsCache.get(apiName)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const rows = await query<{
    id: string
    api_name: string
    field_type: string
    interface: string
    readonly: boolean
    options: Record<string, unknown> | null
  }>(
    `SELECT f.id::text AS id, f.api_name, f.field_type, f.interface, f.readonly, f.options
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1
       AND e.deleted_at IS NULL
     ORDER BY f.sort, f.api_name`,
    [apiName],
  )

  const value = rows.map((row) => ({
    id: String(row.id),
    apiName: String(row.api_name),
    fieldType: String(row.field_type),
    interface: String(row.interface ?? ''),
    readonly: Boolean(row.readonly),
    options: asObject(row.options),
  }))
  entityFieldsCache.set(apiName, {
    value,
    expiresAt: Date.now() + ENTITY_FIELDS_TTL_MS,
  })
  return value
}

export async function loadFormulaFields(
  entityApiName: string,
): Promise<FormulaFieldMeta[]> {
  const fields = await loadEntityFieldMeta(entityApiName)
  const out: FormulaFieldMeta[] = []
  for (const field of fields) {
    if (resolveComputeMode(field.options, field.interface) !== 'formula') {
      continue
    }
    const template = extractFormulaTemplate(field.options)
    if (!template) continue
    out.push({ apiName: field.apiName, template })
  }
  return out
}

export async function loadRollupFields(
  entityApiName: string,
): Promise<Array<{ apiName: string; rollup: RollupConfig }>> {
  const fields = await loadEntityFieldMeta(entityApiName)
  const out: Array<{ apiName: string; rollup: RollupConfig }> = []
  for (const field of fields) {
    if (resolveComputeMode(field.options, field.interface) !== 'rollup') {
      continue
    }
    const rollup = parseRollupConfig(field.options)
    if (!rollup) continue
    out.push({
      apiName: field.apiName,
      rollup: { ...rollup, live: resolveRollupLive(rollup, field.fieldType) },
    })
  }
  return out
}

/** All rollup fields whose childEntity matches (parent ← children). */
export async function loadRollupsByChildEntity(
  childEntityApiName: string,
): Promise<RollupFieldMeta[]> {
  const all = await loadAllRollupFields()
  return all.filter((row) => row.rollup.childEntity === childEntityApiName)
}

async function loadAllRollupFields(): Promise<RollupFieldMeta[]> {
  if (rollupIndexCache && rollupIndexCache.expiresAt > Date.now()) {
    return rollupIndexCache.value
  }

  const rows = await query<{
    parent_entity: string
    api_name: string
    field_type: string
    options: Record<string, unknown> | null
  }>(
    `SELECT e.api_name AS parent_entity, f.api_name, f.field_type, f.options
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.deleted_at IS NULL
       AND (
         f.options->>'computeMode' = 'rollup'
         OR f.options->>'compute_mode' = 'rollup'
         OR f.options ? 'rollup'
       )`,
  )

  const value: RollupFieldMeta[] = []
  for (const row of rows) {
    const options = asObject(row.options)
    const rollup = parseRollupConfig(options)
    if (!rollup) continue
    value.push({
      parentEntity: String(row.parent_entity),
      apiName: String(row.api_name),
      rollup: {
        ...rollup,
        live: resolveRollupLive(rollup, String(row.field_type)),
      },
    })
  }

  rollupIndexCache = {
    value,
    expiresAt: Date.now() + ROLLUP_INDEX_TTL_MS,
  }
  return value
}
