/**
 * Hasura records adapter — production rows via Hasura GraphQL.
 * Registry metadata stays in local Postgres; this module never writes crm_schema.
 */
import { randomUUID } from 'node:crypto'
import { query } from '../../../../db/pool.js'
import {
  CRM_SCHEMA,
  resolveCrmStorageConfig,
} from '../../../../schema/crmStorage.js'
import { assertGqlName, graphqlLiteral, hasuraRequest } from './client.js'
import { resolveCanonicalEntityApiName } from '../../entityName.js'
import type { RecordsListParams, RecordsListResult } from '../../types.js'
import { aggregateSelectFields, groupAggregateRows } from '../../groupAggregate.js'

export interface HasuraEntityConfig {
  endpoint: string | null
  schema: string
  table: string
  root: string
  idField: string
  statusField: string | null
}

const configCache = new Map<string, HasuraEntityConfig>()
const fieldsCache = new Map<string, string[]>()
const fieldTypeCache = new Map<string, Record<string, string>>()

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function graphqlRoot(schema: string, table: string): string {
  if (!schema || schema === 'public') return table
  return `${schema}_${table}`
}

/** Match DDL resolver: `crm.schema` typo → `crm_schema`. */
function normalizePgSchema(raw: string | null | undefined, fallback: string): string {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return fallback
  if (trimmed === 'crm.schema' || trimmed === 'crm-schema') return CRM_SCHEMA
  return trimmed
}

export function clearHasuraRecordsCache(): void {
  configCache.clear()
  fieldsCache.clear()
  fieldTypeCache.clear()
}

export async function resolveHasuraConfig(
  entityApiName: string,
): Promise<HasuraEntityConfig> {
  const apiName = await resolveCanonicalEntityApiName(entityApiName)
  const cached = configCache.get(apiName)
  if (cached) return cached

  const rows = await query<{ backend_config: unknown }>(
    `SELECT backend_config
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [apiName],
  )
  const backend = asObject(rows[0]?.backend_config)
  const hasura = asObject(backend.hasura)
  const storage = resolveCrmStorageConfig(backend, apiName)
  const schema = normalizePgSchema(
    (typeof hasura.schema === 'string' && hasura.schema.trim()) ||
      (typeof backend.schema === 'string' && backend.schema.trim()) ||
      storage.schema,
    CRM_SCHEMA,
  )
  const table =
    (typeof hasura.table === 'string' && hasura.table.trim()) ||
    (typeof backend.table === 'string' && backend.table.trim()) ||
    storage.table ||
    apiName
  const root =
    typeof hasura.root === 'string' && hasura.root.trim()
      ? hasura.root.trim()
      : graphqlRoot(schema, table)
  const idField =
    typeof hasura.idField === 'string' && hasura.idField.trim()
      ? hasura.idField.trim()
      : 'id'
  const statusRaw = hasura.statusField
  const statusField =
    statusRaw === null || statusRaw === ''
      ? null
      : typeof statusRaw === 'string'
        ? statusRaw.trim()
        : 'status'
  const endpoint =
    typeof hasura.endpoint === 'string' && hasura.endpoint.trim()
      ? hasura.endpoint.trim()
      : null

  const config: HasuraEntityConfig = {
    endpoint,
    schema,
    table,
    root: assertGqlName(root),
    idField: assertGqlName(idField),
    statusField: statusField ? assertGqlName(statusField) : null,
  }
  configCache.set(apiName, config)
  setTimeout(() => configCache.delete(apiName), 30_000)
  return config
}

function unwrapTypeKind(type: unknown): string {
  let current = asObject(type)
  while (current.kind === 'NON_NULL' || current.kind === 'LIST') {
    current = asObject(current.ofType)
  }
  return String(current.kind || '')
}

function unwrapTypeName(type: unknown): string {
  let current = asObject(type)
  while (current.kind === 'NON_NULL' || current.kind === 'LIST') {
    current = asObject(current.ofType)
  }
  return String(current.name || '')
}

function isIntGqlType(gqlType: string): boolean {
  const type = gqlType.toLowerCase()
  return (
    type === 'int' ||
    type === 'int2' ||
    type === 'int4' ||
    type === 'int8' ||
    type === 'int64' ||
    type === 'bigint'
  )
}

function isFloatGqlType(gqlType: string): boolean {
  const type = gqlType.toLowerCase()
  return (
    type === 'float' ||
    type === 'float4' ||
    type === 'float8' ||
    type === 'numeric' ||
    type === 'decimal' ||
    type === 'double' ||
    type === 'number'
  )
}

function coerceHasuraValue(value: unknown, gqlType: string | undefined): unknown {
  if (value === null || value === undefined) return value
  const type = gqlType?.trim() || ''
  const typeLower = type.toLowerCase()

  // jsonb/json: keep objects/arrays; stringify only when already a string is fine.
  if (typeLower === 'json' || typeLower === 'jsonb') {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return value
      }
    }
    return value
  }

  if (typeof value === 'object') return value
  if (typeLower === 'boolean' || typeLower === 'bool') {
    if (typeof value === 'boolean') return value
    if (value === true || value === 1 || value === '1' || value === 'true') return true
    if (value === false || value === 0 || value === '0' || value === 'false') return false
    return value
  }
  if (isIntGqlType(type) || isFloatGqlType(type)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return isIntGqlType(type) ? Math.trunc(value) : value
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      const num = Number(value)
      return isIntGqlType(type) ? Math.trunc(num) : num
    }
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value
}

async function loadHasuraFieldTypes(
  config: HasuraEntityConfig,
): Promise<Record<string, string>> {
  const cacheKey = `${config.endpoint ?? ''}|${config.root}`
  const cached = fieldTypeCache.get(cacheKey)
  if (cached) return cached
  try {
    const data = await hasuraRequest<{
      __type?: { fields?: Array<{ name: string; type: unknown }> | null }
    }>(
      `query HasuraColumns { __type(name: ${JSON.stringify(config.root)}) { fields { name type { kind name ofType { kind name ofType { kind name } } } } } }`,
      undefined,
      config.endpoint ?? undefined,
    )
    const types: Record<string, string> = {}
    for (const field of data.__type?.fields ?? []) {
      const kind = unwrapTypeKind(field.type)
      if (kind !== 'SCALAR' && kind !== 'ENUM') continue
      if (!isGqlName(field.name)) continue
      types[field.name] = unwrapTypeName(field.type) || 'String'
    }
    fieldTypeCache.set(cacheKey, types)
    setTimeout(() => fieldTypeCache.delete(cacheKey), 30_000)
    return types
  } catch {
    fieldTypeCache.set(cacheKey, {})
    setTimeout(() => fieldTypeCache.delete(cacheKey), 5_000)
    return {}
  }
}

async function loadScalarFieldNames(entityApiName: string): Promise<string[]> {
  const apiName = await resolveCanonicalEntityApiName(entityApiName)
  const cached = fieldsCache.get(apiName)
  if (cached) return cached
  const rows = await query<{ api_name: string }>(
    `SELECT f.api_name
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1
       AND e.deleted_at IS NULL
       AND upper(f.field_type) <> 'ALIAS'`,
    [apiName],
  )
  const names = rows.map((row) => row.api_name).filter(Boolean)
  fieldsCache.set(apiName, names)
  setTimeout(() => fieldsCache.delete(apiName), 30_000)
  return names
}

function remapField(config: HasuraEntityConfig, field: string): string {
  if (field === 'id') return config.idField
  if (field === 'date_created' || field === 'created_at') {
    return 'created_at'
  }
  if (field === 'date_updated' || field === 'updated_at') {
    return 'updated_at'
  }
  return field
}

function isGqlName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

/** Fields safe for Hasura `_ilike` text search. */
function pickIlikeSearchFields(
  config: HasuraEntityConfig,
  searchFields: string[],
  types: Record<string, string>,
): string[] {
  const hasTypes = Object.keys(types).length > 0
  const seen = new Set<string>()
  const picked: string[] = []

  for (const raw of searchFields) {
    const field = remapField(config, raw)
    if (!isGqlName(field) || seen.has(field)) continue
    seen.add(field)

    if (hasTypes) {
      if (types[field] !== 'String') continue
    } else if (
      field === config.idField ||
      field === 'id' ||
      field === 'created_at' ||
      field === 'updated_at' ||
      field.startsWith('date_') ||
      field.startsWith('user_')
    ) {
      continue
    }

    picked.push(field)
    if (picked.length >= 16) break
  }

  return picked
}

function compileWhereValue(
  config: HasuraEntityConfig,
  value: unknown,
  gqlType?: string,
): unknown {
  if (value === null) return { _is_null: true }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { _eq: coerceHasuraValue(value, gqlType) }
  }
  const ops = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [op, raw] of Object.entries(ops)) {
    switch (op) {
      case '_eq':
      case '_neq':
      case '_gt':
      case '_gte':
      case '_lt':
      case '_lte':
        out[op] = coerceHasuraValue(raw, gqlType)
        break
      case '_in':
      case '_nin':
        out[op] = Array.isArray(raw)
          ? raw.map((entry) => coerceHasuraValue(entry, gqlType))
          : coerceHasuraValue(raw, gqlType)
        break
      case '_like':
      case '_ilike':
      case '_is_null':
        out[op] = raw
        break
      case '_contains':
      case '_icontains':
        out._ilike = `%${String(raw)}%`
        break
      case '_starts_with':
        out._ilike = `${String(raw)}%`
        break
      case '_null':
        out._is_null = Boolean(raw)
        break
      case '_nnull':
        out._is_null = !raw
        break
      default:
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          out[op] = compileWhereNode(config, raw)
        }
        break
    }
  }
  return out
}

function compileWhereNode(
  config: HasuraEntityConfig,
  filter: unknown,
  types: Record<string, string> = {},
): Record<string, unknown> | null {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return null
  const input = filter as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (key === '_and' || key === '_or') {
      if (!Array.isArray(value)) continue
      const children = value
        .map((child) => compileWhereNode(config, child, types))
        .filter((child): child is Record<string, unknown> => Boolean(child))
      if (children.length) out[key] = children
      continue
    }
    if (key === '_not') {
      const child = compileWhereNode(config, value, types)
      if (child) out._not = child
      continue
    }
    const field = remapField(config, key)
    if (!isGqlName(field)) continue
    out[field] = compileWhereValue(config, value, types[field])
  }

  return Object.keys(out).length ? out : null
}

function compileWhere(
  config: HasuraEntityConfig,
  filter: Record<string, unknown> | null | undefined,
  includeDeleted: boolean | undefined,
  search: string | null | undefined,
  searchFields: string[],
  types: Record<string, string> = {},
): Record<string, unknown> | null {
  const parts: Record<string, unknown>[] = []
  const compiled = compileWhereNode(config, filter ?? null, types)
  if (compiled) parts.push(compiled)

  if (!includeDeleted) {
    if ('is_deleted' in types) {
      parts.push({ is_deleted: { _eq: false } })
    } else {
      const statusField = effectiveStatusField(config, types)
      if (statusField) {
        parts.push({ [statusField]: { _neq: 'archived' } })
      }
    }
  }

  const q = search?.trim()
  if (q) {
    // `_ilike` is only valid on String columns. Mixing Int/UUID/DateTime into the
    // OR clause makes Hasura reject the whole query (empty autocomplete results).
    const orFields = pickIlikeSearchFields(config, searchFields, types)
    if (orFields.length) {
      parts.push({
        _or: orFields.map((field) => ({
          [field]: { _ilike: `%${q}%` },
        })),
      })
    }
  }

  if (!parts.length) return null
  if (parts.length === 1) return parts[0] ?? null
  return { _and: parts }
}

function compileOrderBy(
  config: HasuraEntityConfig,
  sort?: string[] | null,
  types: Record<string, string> = {},
): Record<string, string>[] | null {
  if (!sort?.length) return null
  const hasTypes = Object.keys(types).length > 0
  const clauses: Record<string, string>[] = []
  for (const entry of sort) {
    const desc = entry.startsWith('-')
    const field = remapField(config, desc ? entry.slice(1) : entry)
    if (!field || !isGqlName(field)) continue
    // Skip CRM formula/alias fields that are not real Hasura columns (e.g. patient.name).
    if (hasTypes && !(field in types)) continue
    clauses.push({ [field]: desc ? 'desc' : 'asc' })
  }
  return clauses.length ? clauses : null
}

function pickAllowed(allowed: Set<string>, ...names: string[]): string | null {
  for (const name of names) {
    if (allowed.has(name)) return name
  }
  return null
}

/**
 * Hasura has no CRM alias fields (M2A `blocks`, O2M files, formulas).
 * Those are expanded by the records facade after this scalar fetch.
 */
async function selectionSet(
  config: HasuraEntityConfig,
  fields: string[] | null | undefined,
  scalarFields: string[],
): Promise<string> {
  const types = await loadHasuraFieldTypes(config)
  const hasuraColumns = Object.keys(types)
  const allowed = new Set(
    (hasuraColumns.length ? hasuraColumns : scalarFields).filter(isGqlName),
  )
  allowed.add(config.idField)
  allowed.delete('id')
  if (config.idField === 'id') allowed.add('id')

  const requested = new Set<string>()
  requested.add(config.idField)
  if (
    config.statusField &&
    (allowed.has(config.statusField) || hasuraColumns.length === 0)
  ) {
    requested.add(config.statusField)
  }

  const wantsAllScalars =
    !fields?.length || fields.some((field) => {
      const base = field.split(/[.:(]/)[0] ?? field
      return base === '*'
    })

  if (wantsAllScalars) {
    for (const name of allowed) {
      if (isGqlName(name)) requested.add(name)
    }
  }

  if (fields?.length) {
    for (const field of fields) {
      const base = field.split(/[.:(]/)[0] ?? field
      if (base === '*') continue
      if (base === 'id') {
        requested.add(config.idField)
        continue
      }
      if (base === 'date_created' || base === 'created_at') {
        const mapped = pickAllowed(allowed, 'created_at', 'date_created')
        if (mapped) requested.add(mapped)
        else if (!hasuraColumns.length) requested.add('created_at')
        continue
      }
      if (base === 'date_updated' || base === 'updated_at') {
        const mapped = pickAllowed(allowed, 'updated_at', 'date_updated')
        if (mapped) requested.add(mapped)
        else if (!hasuraColumns.length) requested.add('updated_at')
        continue
      }
      if (isGqlName(base) && allowed.has(base)) requested.add(base)
    }
  }

  const lines: string[] = []
  for (const name of requested) {
    if (!isGqlName(name)) continue
    if (name === config.idField && config.idField !== 'id') {
      lines.push(`id: ${name}`)
      lines.push(name)
    } else {
      lines.push(name)
    }
  }
  if (!lines.some((line) => line === 'id' || line.startsWith('id:'))) {
    lines.unshift(config.idField === 'id' ? 'id' : `id: ${config.idField}`)
  }
  return lines.join('\n      ')
}

function toPublicRecord(
  config: HasuraEntityConfig,
  row: Record<string, unknown> | null | undefined,
  fields?: string[] | null,
): Record<string, unknown> {
  const raw = asObject(row)
  const id = raw.id ?? raw[config.idField]
  const merged: Record<string, unknown> = {
    ...raw,
    id,
    date_created: raw.date_created ?? raw.created_at,
    date_updated: raw.date_updated ?? raw.updated_at,
  }
  if (!fields?.length) return merged
  const wantsAll = fields.some((field) => {
    const base = field.split(/[.:(]/)[0] ?? field
    return base === '*'
  })
  if (wantsAll) return merged
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const base = field.split(/[.:(]/)[0] ?? field
    if (base === '*') continue
    if (base in merged) out[base] = merged[base]
  }
  if (!('id' in out)) out.id = merged.id
  return out
}

function writeObject(
  config: HasuraEntityConfig,
  data: Record<string, unknown>,
  scalarFields: string[],
  types: Record<string, string>,
): { payload: Record<string, unknown>; dropped: string[] } {
  const hasuraNames = Object.keys(types)
  const allowed = new Set(scalarFields.filter(isGqlName))
  allowed.add(config.idField)
  if (config.statusField) allowed.add(config.statusField)
  allowed.add('created_at')
  allowed.add('updated_at')
  for (const name of hasuraNames) allowed.add(name)

  const out: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (key === 'id') {
      if (value !== '' && value != null) {
        out[config.idField] = coerceHasuraValue(
          value,
          types[config.idField] || 'String',
        )
      }
      continue
    }
    if (key === 'date_created') {
      if (!hasuraNames.length || 'created_at' in types || 'date_created' in types) {
        const target = 'created_at' in types || !hasuraNames.length ? 'created_at' : 'date_created'
        out[target] = coerceHasuraValue(
          value,
          types.created_at || types.date_created,
        )
      }
      continue
    }
    if (key === 'date_updated') {
      if (!hasuraNames.length || 'updated_at' in types || 'date_updated' in types) {
        const target = 'updated_at' in types || !hasuraNames.length ? 'updated_at' : 'date_updated'
        out[target] = coerceHasuraValue(
          value,
          types.updated_at || types.date_updated,
        )
      }
      continue
    }
    const field = remapField(config, key)
    if (hasuraNames.length && !(field in types)) {
      dropped.push(key)
      continue
    }
    if (!allowed.has(field)) {
      dropped.push(key)
      continue
    }
    out[field] = coerceHasuraValue(value, types[field])
  }
  return { payload: out, dropped }
}

/** Drop insert/update keys Hasura does not expose (lean junctions, drifted columns). */
function pruneToHasuraColumns(
  payload: Record<string, unknown>,
  types: Record<string, string>,
): { payload: Record<string, unknown>; dropped: string[] } {
  const hasuraNames = Object.keys(types)
  if (!hasuraNames.length) return { payload, dropped: [] }
  const out: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(payload)) {
    if (key in types) out[key] = value
    else dropped.push(key)
  }
  return { payload: out, dropped }
}

/**
 * When GraphQL is missing promoted columns (e.g. new Address/JSON field),
 * run Hasura DDL + metadata reload once, then refresh introspection.
 */
async function ensureHasuraColumnsForWrite(
  entityApiName: string,
  missingFields: string[],
): Promise<Record<string, string>> {
  if (!missingFields.length) {
    const config = await resolveHasuraConfig(entityApiName)
    return loadHasuraFieldTypes(config)
  }

  const { syncHasuraEntityColumns } = await import('./ddl.js')
  const { reloadHasuraMetadata } = await import('./metadata.js')
  const sync = await syncHasuraEntityColumns(entityApiName, { dryRun: false })
  // Column may already exist in Postgres but not yet in GraphQL — force metadata reload.
  if (!sync.reloaded) {
    try {
      await reloadHasuraMetadata()
    } catch (err) {
      console.warn('[hasura] reload_metadata failed after missing-column check', err)
    }
  }
  clearHasuraRecordsCache()
  const config = await resolveHasuraConfig(entityApiName)
  const types = await loadHasuraFieldTypes(config)
  const stillMissing = missingFields.filter((field) => !(field in types))
  if (stillMissing.length) {
    const syncHint =
      sync.applied > 0
        ? `DDL applied ${sync.applied} action(s).`
        : sync.actions.length === 0
          ? 'No DDL actions planned (column may exist under a different schema/table than Hasura tracks).'
          : `DDL errors: ${sync.errors.map((e) => e.error).join('; ') || 'unknown'}`
    throw new Error(
      `Hasura GraphQL does not expose field(s): ${stillMissing.join(', ')}. ` +
        `Track/add the column on the Hasura source table and reload metadata. (${syncHint})`,
    )
  }
  return types
}

async function buildHasuraWritePayload(
  entityApiName: string,
  data: Record<string, unknown>,
  options?: { omitId?: boolean },
): Promise<{
  config: HasuraEntityConfig
  scalarFields: string[]
  types: Record<string, string>
  payload: Record<string, unknown>
}> {
  let config = await resolveHasuraConfig(entityApiName)
  let scalarFields = await loadScalarFieldNames(entityApiName)
  let types = await loadHasuraFieldTypes(config)

  let built = writeObject(config, data, scalarFields, types)
  if (options?.omitId) delete built.payload[config.idField]

  let pruned = pruneToHasuraColumns(built.payload, types)
  const missing = [...new Set([...built.dropped, ...pruned.dropped])]

  if (missing.length) {
    types = await ensureHasuraColumnsForWrite(entityApiName, missing)
    config = await resolveHasuraConfig(entityApiName)
    scalarFields = await loadScalarFieldNames(entityApiName)
    built = writeObject(config, data, scalarFields, types)
    if (options?.omitId) delete built.payload[config.idField]
    pruned = pruneToHasuraColumns(built.payload, types)
    const stillMissing = [...new Set([...built.dropped, ...pruned.dropped])]
    if (stillMissing.length) {
      throw new Error(
        `Cannot write field(s) to Hasura (not in GraphQL schema): ${stillMissing.join(', ')}`,
      )
    }
  }

  return {
    config,
    scalarFields,
    types,
    payload: pruned.payload,
  }
}

function effectiveStatusField(
  config: HasuraEntityConfig,
  types: Record<string, string>,
): string | null {
  if (!config.statusField) return null
  // Only filter/write status when Hasura actually exposes the column. Empty
  // introspection must not fall back to assuming `status` (lean junctions).
  if (!(config.statusField in types)) return null
  return config.statusField
}

function orderByLiteral(orderBy: Record<string, string>[] | null): string {
  if (!orderBy?.length) return 'null'
  const inner = orderBy
    .map((clause) => {
      const [field, dir] = Object.entries(clause)[0] ?? []
      if (!field || !dir) return null
      return `{${assertGqlName(field)}: ${dir}}`
    })
    .filter(Boolean)
    .join(', ')
  return `[${inner}]`
}

export async function hasuraFindMany(
  collection: string,
  params: RecordsListParams = {},
): Promise<RecordsListResult> {
  const config = await resolveHasuraConfig(collection)
  const scalarFields = await loadScalarFieldNames(collection)
  const types = await loadHasuraFieldTypes(config)
  const where = compileWhere(
    config,
    params.filter ?? null,
    params.includeDeleted,
    params.search,
    scalarFields,
    types,
  )
  const orderBy = compileOrderBy(config, params.sort, types)
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0
  const root = config.root
  const agg = `${root}_aggregate`
  const select = await selectionSet(config, params.fields, scalarFields)
  const args: string[] = [`where: ${graphqlLiteral(where)}`, `offset: ${offset}`]
  if (limit >= 0) args.push(`limit: ${limit}`)
  const orderArg = orderByLiteral(orderBy)
  if (orderArg !== 'null') args.push(`order_by: ${orderArg}`)
  const queryText = /* GraphQL */ `
    query HasuraFindMany {
      ${root}(${args.join(', ')}) {
        ${select}
      }
      ${agg}(where: ${graphqlLiteral(where)}) {
        aggregate { count }
      }
    }
  `
  const data = await hasuraRequest<Record<string, unknown>>(
    queryText,
    undefined,
    config.endpoint ?? undefined,
  )
  const nodesRaw = Array.isArray(data[root]) ? data[root] : []
  const aggNode = asObject(data[agg])
  const aggregate = asObject(aggNode.aggregate)
  return {
    nodes: (nodesRaw as Record<string, unknown>[]).map((row) =>
      toPublicRecord(config, row, params.fields),
    ),
    totalCount: Number(aggregate.count ?? 0),
  }
}

export async function hasuraFindOne(
  collection: string,
  id: string,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const config = await resolveHasuraConfig(collection)
  const scalarFields = await loadScalarFieldNames(collection)
  const types = await loadHasuraFieldTypes(config)
  const pk = `${config.root}_by_pk`
  const select = await selectionSet(config, fields, scalarFields)
  const idType = types[config.idField] || 'String'
  const pkValue = coerceHasuraValue(id, idType)
  const queryText = /* GraphQL */ `
    query HasuraFindOne($id: ${idType}!) {
      ${pk}(${config.idField}: $id) {
        ${select}
      }
    }
  `
  const data = await hasuraRequest<Record<string, unknown>>(
    queryText,
    { id: pkValue },
    config.endpoint ?? undefined,
  )
  const row = asObject(data[pk])
  if (!Object.keys(row).length && data[pk] == null) {
    throw new Error(`Record not found: ${collection}/${id}`)
  }
  return toPublicRecord(config, row, fields)
}

export async function hasuraCreate(
  collection: string,
  data: Record<string, unknown>,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const built = await buildHasuraWritePayload(collection, data)
  const { config, scalarFields, types } = built
  let payload = built.payload
  const statusField = effectiveStatusField(config, types)
  if (payload[config.idField] == null || payload[config.idField] === '') {
    const idType = types[config.idField] || 'String'
    if (!isIntGqlType(idType)) payload[config.idField] = randomUUID()
    else delete payload[config.idField]
  }
  if ('is_deleted' in types && payload.is_deleted == null) {
    payload.is_deleted = false
  }
  if ('is_active' in types && payload.is_active == null) {
    payload.is_active = true
  }
  if (statusField && !('is_deleted' in types) && payload[statusField] == null) {
    payload[statusField] = 'published'
  }
  const mutation = `insert_${config.root}_one`
  const select = await selectionSet(config, fields, scalarFields)
  const inputName = `${config.root}_insert_input`
  const queryText = /* GraphQL */ `
    mutation HasuraCreate($object: ${inputName}!) {
      ${mutation}(object: $object) {
        ${select}
      }
    }
  `
  const result = await hasuraRequest<Record<string, unknown>>(
    queryText,
    { object: payload },
    config.endpoint ?? undefined,
  )
  const row = asObject(result[mutation])
  const id = String(row.id ?? row[config.idField] ?? payload[config.idField])
  return hasuraFindOne(collection, id, fields)
}

export async function hasuraUpdate(
  collection: string,
  id: string,
  data: Record<string, unknown>,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const built = await buildHasuraWritePayload(collection, data, { omitId: true })
  const { config, scalarFields, types, payload } = built
  if (Object.keys(payload).length === 0) {
    return hasuraFindOne(collection, id, fields)
  }
  const mutation = `update_${config.root}_by_pk`
  const select = await selectionSet(config, fields, scalarFields)
  const pkType = `${config.root}_pk_columns_input`
  const setType = `${config.root}_set_input`
  const pkValue = coerceHasuraValue(id, types[config.idField] || 'String')
  const queryText = /* GraphQL */ `
    mutation HasuraUpdate($pk: ${pkType}!, $set: ${setType}!) {
      ${mutation}(pk_columns: $pk, _set: $set) {
        ${select}
      }
    }
  `
  const result = await hasuraRequest<Record<string, unknown>>(
    queryText,
    { pk: { [config.idField]: pkValue }, set: payload },
    config.endpoint ?? undefined,
  )
  if (result[mutation] == null) {
    throw new Error(`Record not found: ${collection}/${id}`)
  }
  return hasuraFindOne(collection, id, fields)
}

export async function hasuraSoftDelete(
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  const config = await resolveHasuraConfig(collection)
  const types = await loadHasuraFieldTypes(config)
  if ('is_deleted' in types) {
    return hasuraUpdate(collection, id, { is_deleted: true })
  }
  const statusField = effectiveStatusField(config, types)
  if (!statusField) {
    // Lean junctions (no archive column): unlink by removing the row.
    let existing: Record<string, unknown> = { id }
    try {
      existing = await hasuraFindOne(collection, id, null)
    } catch {
      /* already gone */
    }
    await hasuraHardDelete(collection, id)
    return existing
  }
  return hasuraUpdate(collection, id, { [statusField]: 'archived' })
}

export async function hasuraRestore(
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  const config = await resolveHasuraConfig(collection)
  const types = await loadHasuraFieldTypes(config)
  if ('is_deleted' in types) {
    return hasuraUpdate(collection, id, { is_deleted: false })
  }
  const statusField = effectiveStatusField(config, types)
  if (!statusField) {
    throw new Error(`Hasura restore is not supported on "${collection}"`)
  }
  return hasuraUpdate(collection, id, { [statusField]: 'published' })
}

export async function hasuraHardDelete(
  collection: string,
  id: string,
): Promise<boolean> {
  const config = await resolveHasuraConfig(collection)
  const types = await loadHasuraFieldTypes(config)
  const mutation = `delete_${config.root}_by_pk`
  const idType = types[config.idField] || 'String'
  const pkValue = coerceHasuraValue(id, idType)
  const queryText = /* GraphQL */ `
    mutation HasuraHardDelete($id: ${idType}!) {
      ${mutation}(${config.idField}: $id) {
        ${config.idField}
      }
    }
  `
  await hasuraRequest(queryText, { id: pkValue }, config.endpoint ?? undefined)
  return true
}

const HASURA_GROUP_PAGE = 1000
const HASURA_GROUP_MAX_ROWS = 25_000

async function hasuraScanRows(
  collection: string,
  params: {
    filter?: Record<string, unknown> | null
    fields: string[]
  },
): Promise<Record<string, unknown>[]> {
  const config = await resolveHasuraConfig(collection)
  const scalarFields = await loadScalarFieldNames(collection)
  const types = await loadHasuraFieldTypes(config)
  const where = compileWhere(
    config,
    params.filter ?? null,
    false,
    null,
    scalarFields,
    types,
  )
  const root = config.root
  const select = await selectionSet(config, params.fields, scalarFields)
  const nodes: Record<string, unknown>[] = []
  let offset = 0

  while (nodes.length < HASURA_GROUP_MAX_ROWS) {
    const args = [`limit: ${HASURA_GROUP_PAGE}`, `offset: ${offset}`]
    if (where) args.unshift(`where: ${graphqlLiteral(where)}`)
    const queryText = /* GraphQL */ `
      query HasuraAggregateScan {
        ${root}(${args.join(', ')}) {
          ${select}
        }
      }
    `
    const data = await hasuraRequest<Record<string, unknown>>(
      queryText,
      undefined,
      config.endpoint ?? undefined,
    )
    const page = Array.isArray(data[root]) ? (data[root] as Record<string, unknown>[]) : []
    for (const row of page) {
      nodes.push(toPublicRecord(config, row, params.fields))
    }
    if (page.length < HASURA_GROUP_PAGE) break
    offset += HASURA_GROUP_PAGE
    if (offset >= HASURA_GROUP_MAX_ROWS) {
      throw new Error(
        `Hasura aggregate groupBy exceeded ${HASURA_GROUP_MAX_ROWS} matching rows for "${collection}"`,
      )
    }
  }

  return nodes
}

function isHasuraSummableType(gqlType: string | undefined): boolean {
  if (!gqlType) return false
  return isIntGqlType(gqlType) || isFloatGqlType(gqlType)
}

function flatAggregateRows(
  nodes: Record<string, unknown>[],
  aggregate: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [fn, field] of Object.entries(aggregate)) {
    const lower = fn.toLowerCase()
    const key = String(field ?? '*') || '*'
    if (lower === 'count') {
      out[fn] = { [key]: nodes.length }
      continue
    }
    if (!['sum', 'avg', 'min', 'max'].includes(lower)) {
      throw new Error(`hasuraAggregate: unsupported function "${fn}"`)
    }
    const values = nodes.map((node) => {
      const raw = key === '*' ? node.id : node[key]
      const num = Number(raw)
      return Number.isFinite(num) ? num : 0
    })
    let value = 0
    if (lower === 'sum') value = values.reduce((sum, n) => sum + n, 0)
    else if (lower === 'avg') {
      value = values.length
        ? values.reduce((sum, n) => sum + n, 0) / values.length
        : 0
    } else if (lower === 'min') value = values.length ? Math.min(...values) : 0
    else if (lower === 'max') value = values.length ? Math.max(...values) : 0
    out[fn] = { [key]: value }
  }
  return out
}

export async function hasuraAggregate(
  collection: string,
  options: {
    aggregate: Record<string, unknown>
    groupBy?: string[] | null
    filter?: Record<string, unknown> | null
    limit?: number
  },
): Promise<Record<string, unknown>[]> {
  const aggEntries = Object.entries(options.aggregate)
  if (!aggEntries.length) {
    throw new Error('hasuraAggregate: at least one aggregate function is required')
  }

  const groupFields = (options.groupBy ?? []).filter(
    (field): field is string => Boolean(field),
  )
  if (groupFields.length) {
    const nodes = await hasuraScanRows(collection, {
      filter: options.filter ?? null,
      fields: aggregateSelectFields(groupFields, options.aggregate),
    })
    return groupAggregateRows(
      nodes,
      groupFields,
      options.aggregate,
      options.limit ?? -1,
    )
  }

  const config = await resolveHasuraConfig(collection)
  const scalarFields = await loadScalarFieldNames(collection)
  const types = await loadHasuraFieldTypes(config)
  const hasTypeInfo = Object.keys(types).length > 0
  const needsClientAgg =
    hasTypeInfo &&
    aggEntries.some(([fn, field]) => {
      const lower = fn.toLowerCase()
      if (lower === 'count') return false
      const mapped = remapField(config, String(field ?? '*'))
      return !isHasuraSummableType(types[mapped])
    })
  if (needsClientAgg) {
    const nodes = await hasuraScanRows(collection, {
      filter: options.filter ?? null,
      fields: aggregateSelectFields([], options.aggregate),
    })
    return [flatAggregateRows(nodes, options.aggregate)]
  }

  const where = compileWhere(
    config,
    options.filter ?? null,
    false,
    null,
    scalarFields,
    types,
  )

  const aggFields: string[] = []
  for (const [fn, field] of aggEntries) {
    const lower = fn.toLowerCase()
    const column = String(field ?? '*')
    if (lower === 'count') {
      aggFields.push('count')
      continue
    }
    const mapped = remapField(config, column)
    if (!isGqlName(mapped)) {
      throw new Error(`hasuraAggregate: invalid field "${column}"`)
    }
    if (!['sum', 'avg', 'min', 'max'].includes(lower)) {
      throw new Error(`hasuraAggregate: unsupported function "${fn}"`)
    }
    aggFields.push(`${lower} { ${mapped} }`)
  }

  const root = `${config.root}_aggregate`
  const queryText = /* GraphQL */ `
    query HasuraAggregate {
      ${root}(where: ${graphqlLiteral(where)}) {
        aggregate {
          ${aggFields.join('\n          ')}
        }
      }
    }
  `
  const data = await hasuraRequest<Record<string, unknown>>(
    queryText,
    undefined,
    config.endpoint ?? undefined,
  )
  const aggregate = asObject(asObject(data[root]).aggregate)
  const out: Record<string, unknown> = {}
  for (const [fn, field] of aggEntries) {
    const lower = fn.toLowerCase()
    const key = String(field ?? '*') || '*'
    if (lower === 'count') {
      out[fn] = { [key]: Number(aggregate.count ?? 0) }
      continue
    }
    const mapped = remapField(config, key)
    const bucket = asObject(aggregate[lower])
    const num = Number(bucket[mapped] ?? 0)
    out[fn] = { [key]: Number.isNaN(num) ? 0 : num }
  }
  return [out]
}
