/**
 * Directus records adapter — production rows via Directus GraphQL (`/graphql`).
 * Registry metadata stays in local Postgres. DIRECTUS_RUNTIME HTTP SDK stays off.
 */
import { randomUUID } from 'node:crypto'
import { query } from '../../../../db/pool.js'
import { assertGqlName, directusRequest, graphqlLiteral } from './client.js'
import type { RecordsAggregateOptions, RecordsListParams, RecordsListResult } from '../../types.js'
import { aggregateSelectFields, groupAggregateRows } from '../../groupAggregate.js'

export interface DirectusEntityConfig {
  endpoint: string | null
  collection: string
  idField: string
  statusField: string | null
}

const configCache = new Map<string, DirectusEntityConfig>()
const fieldsCache = new Map<string, string[]>()
const inputTypeCache = new Map<string, Record<string, string>>()

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function firstAggregate(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asObject(value[0])
  return asObject(value)
}

function isGqlName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

export function clearDirectusRecordsCache(): void {
  configCache.clear()
  fieldsCache.clear()
  inputTypeCache.clear()
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
  return type === 'int' || type === 'int64' || type === 'bigint'
}

function isFloatGqlType(gqlType: string): boolean {
  const type = gqlType.toLowerCase()
  return type === 'float' || type === 'decimal' || type === 'number'
}

function coerceDirectusValue(value: unknown, gqlType: string | undefined): unknown {
  if (value === null || value === undefined) return value
  const type = gqlType?.trim() || 'String'
  if (type.toLowerCase() === 'boolean') {
    if (typeof value === 'boolean') return value
    if (value === true || value === 1 || value === '1' || value === 'true') return true
    if (value === false || value === 0 || value === '0' || value === 'false') return false
    return value
  }
  if (type.toLowerCase() === 'json' || type.toLowerCase() === 'jsonb') return value
  if (isIntGqlType(type) || isFloatGqlType(type)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return isIntGqlType(type) ? Math.trunc(value) : value
    }
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value
}

async function loadDirectusInputTypes(
  config: DirectusEntityConfig,
  kind: 'create' | 'update',
): Promise<Record<string, string>> {
  const typeName = `${kind}_${config.collection}_input`
  const cacheKey = `${config.endpoint ?? ''}|${typeName}`
  const cached = inputTypeCache.get(cacheKey)
  if (cached) return cached
  try {
    const data = await directusRequest<{
      __type?: {
        inputFields?: Array<{ name: string; type: unknown }> | null
      } | null
    }>(
      `query DirectusInputTypes {
        __type(name: ${JSON.stringify(typeName)}) {
          inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
        }
      }`,
      undefined,
      config.endpoint ?? undefined,
    )
    const types: Record<string, string> = {}
    for (const field of data.__type?.inputFields ?? []) {
      if (!isGqlName(field.name)) continue
      const name = unwrapTypeName(field.type)
      if (name) types[field.name] = name
    }
    inputTypeCache.set(cacheKey, types)
    setTimeout(() => inputTypeCache.delete(cacheKey), 30_000)
    return types
  } catch {
    inputTypeCache.set(cacheKey, {})
    setTimeout(() => inputTypeCache.delete(cacheKey), 5_000)
    return {}
  }
}

function resolveWriteType(field: string, inputTypes: Record<string, string>): string {
  return inputTypes[field] || 'String'
}

export async function resolveDirectusConfig(
  entityApiName: string,
): Promise<DirectusEntityConfig> {
  const cached = configCache.get(entityApiName)
  if (cached) return cached

  const rows = await query<{ backend_config: unknown }>(
    `SELECT backend_config
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [entityApiName],
  )
  const backend = asObject(rows[0]?.backend_config)
  const directus = asObject(backend.directus)
  const collectionRaw =
    (typeof directus.collection === 'string' && directus.collection.trim()) ||
    (typeof directus.table === 'string' && directus.table.trim()) ||
    entityApiName
  const idField =
    typeof directus.idField === 'string' && directus.idField.trim()
      ? directus.idField.trim()
      : 'id'
  const statusRaw = directus.statusField
  const statusField =
    statusRaw === null || statusRaw === ''
      ? null
      : typeof statusRaw === 'string'
        ? statusRaw.trim()
        : 'status'
  const endpoint =
    typeof directus.endpoint === 'string' && directus.endpoint.trim()
      ? directus.endpoint.trim()
      : null

  const config: DirectusEntityConfig = {
    endpoint,
    collection: assertGqlName(collectionRaw),
    idField: assertGqlName(idField),
    statusField: statusField ? assertGqlName(statusField) : null,
  }
  configCache.set(entityApiName, config)
  setTimeout(() => configCache.delete(entityApiName), 30_000)
  return config
}

async function loadScalarFieldNames(entityApiName: string): Promise<string[]> {
  const cached = fieldsCache.get(entityApiName)
  if (cached) return cached
  const rows = await query<{ api_name: string }>(
    `SELECT f.api_name
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1
       AND e.deleted_at IS NULL
       AND upper(f.field_type) <> 'ALIAS'`,
    [entityApiName],
  )
  const names = rows.map((row) => row.api_name).filter(Boolean)
  fieldsCache.set(entityApiName, names)
  setTimeout(() => fieldsCache.delete(entityApiName), 30_000)
  return names
}

function remapField(config: DirectusEntityConfig, field: string): string {
  if (field === 'id') return config.idField
  if (field === 'date_created' || field === 'created_at') return 'date_created'
  if (field === 'date_updated' || field === 'updated_at') return 'date_updated'
  return field
}

function compileFilterValue(config: DirectusEntityConfig, value: unknown): unknown {
  if (value === null) return { _null: true }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { _eq: value }
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
      case '_in':
      case '_nin':
      case '_contains':
      case '_icontains':
      case '_ncontains':
      case '_starts_with':
      case '_nstarts_with':
      case '_ends_with':
      case '_null':
      case '_nnull':
      case '_empty':
      case '_nempty':
        out[op] = raw
        break
      case '_ilike':
        out._icontains = String(raw).replace(/%/g, '')
        break
      case '_like':
        out._contains = String(raw).replace(/%/g, '')
        break
      case '_is_null':
        out._null = Boolean(raw)
        break
      default:
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          out[op] = compileFilterNode(config, raw)
        }
        break
    }
  }
  return out
}

function compileFilterNode(
  config: DirectusEntityConfig,
  filter: unknown,
): Record<string, unknown> | null {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return null
  const input = filter as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (key === '_and' || key === '_or') {
      if (!Array.isArray(value)) continue
      const children = value
        .map((child) => compileFilterNode(config, child))
        .filter((child): child is Record<string, unknown> => Boolean(child))
      if (children.length) out[key] = children
      continue
    }
    if (key === '_not' || key === '_none' || key === '_some') {
      const child = compileFilterNode(config, value)
      if (child) out[key] = child
      continue
    }
    const field = remapField(config, key)
    if (!isGqlName(field)) continue
    out[field] = compileFilterValue(config, value)
  }
  return Object.keys(out).length ? out : null
}

function compileFilter(
  config: DirectusEntityConfig,
  filter: Record<string, unknown> | null | undefined,
  includeDeleted: boolean | undefined,
): Record<string, unknown> | null {
  const parts: Record<string, unknown>[] = []
  const compiled = compileFilterNode(config, filter ?? null)
  if (compiled) parts.push(compiled)
  if (!includeDeleted && config.statusField) {
    parts.push({ [config.statusField]: { _neq: 'archived' } })
  }
  if (!parts.length) return null
  if (parts.length === 1) return parts[0] ?? null
  return { _and: parts }
}

function compileSort(
  config: DirectusEntityConfig,
  sort?: string[] | null,
): string[] | null {
  if (!sort?.length) return null
  const clauses: string[] = []
  for (const entry of sort) {
    const desc = entry.startsWith('-')
    const field = remapField(config, desc ? entry.slice(1) : entry)
    if (!field || !isGqlName(field)) continue
    clauses.push(desc ? `-${field}` : field)
  }
  return clauses.length ? clauses : null
}

function selectionSet(
  config: DirectusEntityConfig,
  fields: string[] | null | undefined,
  scalarFields: string[],
): string {
  const requested = new Set<string>()
  requested.add(config.idField)
  if (config.statusField) requested.add(config.statusField)

  if (fields?.length) {
    for (const field of fields) {
      const base = field.split(/[.:(]/)[0] ?? field
      if (base === 'id') {
        requested.add(config.idField)
        continue
      }
      if (base === 'date_created' || base === 'created_at') {
        requested.add('date_created')
        continue
      }
      if (base === 'date_updated' || base === 'updated_at') {
        requested.add('date_updated')
        continue
      }
      if (isGqlName(base)) requested.add(base)
    }
  } else {
    for (const name of scalarFields) {
      if (isGqlName(name)) requested.add(name)
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
  config: DirectusEntityConfig,
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
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const base = field.split(/[.:(]/)[0] ?? field
    if (base in merged) out[base] = merged[base]
  }
  if (!('id' in out)) out.id = merged.id
  return out
}

function writeObject(
  config: DirectusEntityConfig,
  data: Record<string, unknown>,
  scalarFields: string[],
  inputTypes: Record<string, string>,
): Record<string, unknown> {
  const allowed = new Set(scalarFields.filter(isGqlName))
  allowed.add(config.idField)
  if (config.statusField) allowed.add(config.statusField)
  allowed.add('date_created')
  allowed.add('date_updated')

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (key === 'id') {
      if (value !== '' && value != null) {
        out[config.idField] = coerceDirectusValue(
          value,
          resolveWriteType(config.idField, inputTypes),
        )
      }
      continue
    }
    if (key === 'created_at') {
      out.date_created = coerceDirectusValue(
        value,
        resolveWriteType('date_created', inputTypes),
      )
      continue
    }
    if (key === 'updated_at') {
      out.date_updated = coerceDirectusValue(
        value,
        resolveWriteType('date_updated', inputTypes),
      )
      continue
    }
    const field = remapField(config, key)
    if (!allowed.has(field)) continue
    out[field] = coerceDirectusValue(value, resolveWriteType(field, inputTypes))
  }
  return out
}

function listArgs(
  config: DirectusEntityConfig,
  params: {
    filter?: Record<string, unknown> | null
    includeDeleted?: boolean
    search?: string | null
    sort?: string[] | null
    limit?: number
    offset?: number
  },
): string {
  const parts: string[] = []
  const filter = compileFilter(config, params.filter ?? null, params.includeDeleted)
  if (filter) parts.push(`filter: ${graphqlLiteral(filter)}`)
  const q = params.search?.trim()
  if (q) parts.push(`search: ${JSON.stringify(q)}`)
  const sort = compileSort(config, params.sort)
  if (sort) parts.push(`sort: ${graphqlLiteral(sort)}`)
  if (params.limit != null && params.limit >= 0) parts.push(`limit: ${params.limit}`)
  if (params.offset != null && params.offset > 0) parts.push(`offset: ${params.offset}`)
  return parts.join(', ')
}

export async function directusFindMany(
  collection: string,
  params: RecordsListParams = {},
): Promise<RecordsListResult> {
  const config = await resolveDirectusConfig(collection)
  const scalarFields = await loadScalarFieldNames(collection)
  const root = config.collection
  const agg = `${root}_aggregated`
  const select = selectionSet(config, params.fields, scalarFields)
  const args = listArgs(config, {
    filter: params.filter ?? null,
    includeDeleted: params.includeDeleted,
    search: params.search,
    sort: params.sort,
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  })
  const aggArgs = listArgs(config, {
    filter: params.filter ?? null,
    includeDeleted: params.includeDeleted,
    search: params.search,
  })
  const queryText = /* GraphQL */ `
    query DirectusFindMany {
      ${root}${args ? `(${args})` : ''} {
        ${select}
      }
      ${agg}${aggArgs ? `(${aggArgs})` : ''} {
        count { ${config.idField} }
      }
    }
  `
  const data = await directusRequest<Record<string, unknown>>(
    queryText,
    undefined,
    config.endpoint ?? undefined,
  )
  const nodesRaw = Array.isArray(data[root]) ? data[root] : []
  const aggRow = firstAggregate(data[agg])
  const countBucket = asObject(aggRow.count)
  const totalCount = Number(
    countBucket[config.idField] ?? countBucket.id ?? aggRow.countAll ?? 0,
  )
  return {
    nodes: (nodesRaw as Record<string, unknown>[]).map((row) =>
      toPublicRecord(config, row, params.fields),
    ),
    totalCount,
  }
}

export async function directusFindOne(
  collection: string,
  id: string,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const config = await resolveDirectusConfig(collection)
  const scalarFields = await loadScalarFieldNames(collection)
  const select = selectionSet(config, fields, scalarFields)
  const filter = { [config.idField]: { _eq: id } }
  const queryText = /* GraphQL */ `
    query DirectusFindOne {
      ${config.collection}(filter: ${graphqlLiteral(filter)}, limit: 1) {
        ${select}
      }
    }
  `
  const data = await directusRequest<Record<string, unknown>>(
    queryText,
    undefined,
    config.endpoint ?? undefined,
  )
  const nodes = Array.isArray(data[config.collection])
    ? (data[config.collection] as Record<string, unknown>[])
    : []
  const row = nodes[0]
  if (!row) throw new Error(`Record not found: ${collection}/${id}`)
  return toPublicRecord(config, row, fields)
}

export async function directusCreate(
  collection: string,
  data: Record<string, unknown>,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const config = await resolveDirectusConfig(collection)
  const scalarFields = await loadScalarFieldNames(collection)
  const inputTypes = await loadDirectusInputTypes(config, 'create')
  const payload = writeObject(config, data, scalarFields, inputTypes)
  const idType = resolveWriteType(config.idField, inputTypes)
  if (payload[config.idField] == null || payload[config.idField] === '') {
    if (!isIntGqlType(idType) && idType.toLowerCase() !== 'id') {
      payload[config.idField] = randomUUID()
    } else {
      delete payload[config.idField]
    }
  }
  if (config.statusField && payload[config.statusField] == null) {
    payload[config.statusField] = 'published'
  }
  const mutation = `create_${config.collection}_item`
  const select = selectionSet(config, fields, scalarFields)
  const queryText = /* GraphQL */ `
    mutation DirectusCreate {
      ${mutation}(data: ${graphqlLiteral(payload)}) {
        ${select}
      }
    }
  `
  const result = await directusRequest<Record<string, unknown>>(
    queryText,
    undefined,
    config.endpoint ?? undefined,
  )
  const row = asObject(result[mutation])
  const id = String(row.id ?? row[config.idField] ?? payload[config.idField])
  return directusFindOne(collection, id, fields)
}

export async function directusUpdate(
  collection: string,
  id: string,
  data: Record<string, unknown>,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const config = await resolveDirectusConfig(collection)
  const scalarFields = await loadScalarFieldNames(collection)
  const inputTypes = await loadDirectusInputTypes(config, 'update')
  const payload = writeObject(config, data, scalarFields, inputTypes)
  delete payload[config.idField]
  const mutation = `update_${config.collection}_item`
  const select = selectionSet(config, fields, scalarFields)
  const queryText = /* GraphQL */ `
    mutation DirectusUpdate {
      ${mutation}(id: ${graphqlLiteral(String(id))}, data: ${graphqlLiteral(payload)}) {
        ${select}
      }
    }
  `
  const result = await directusRequest<Record<string, unknown>>(
    queryText,
    undefined,
    config.endpoint ?? undefined,
  )
  if (result[mutation] == null) {
    throw new Error(`Record not found: ${collection}/${id}`)
  }
  return directusFindOne(collection, id, fields)
}

export async function directusSoftDelete(
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  const config = await resolveDirectusConfig(collection)
  if (!config.statusField) {
    throw new Error(
      `Directus soft delete requires statusField on "${collection}" (or set backend_config.directus.statusField)`,
    )
  }
  return directusUpdate(collection, id, { [config.statusField]: 'archived' })
}

export async function directusRestore(
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  const config = await resolveDirectusConfig(collection)
  if (!config.statusField) {
    throw new Error(
      `Directus restore requires statusField on "${collection}" (or set backend_config.directus.statusField)`,
    )
  }
  return directusUpdate(collection, id, { [config.statusField]: 'published' })
}

export async function directusHardDelete(
  collection: string,
  id: string,
): Promise<boolean> {
  const config = await resolveDirectusConfig(collection)
  const mutation = `delete_${config.collection}_item`
  const queryText = /* GraphQL */ `
    mutation DirectusHardDelete {
      ${mutation}(id: ${graphqlLiteral(id)}) {
        ${config.idField}
      }
    }
  `
  await directusRequest(queryText, undefined, config.endpoint ?? undefined)
  return true
}

function directusAggSelection(
  config: DirectusEntityConfig,
  aggEntries: Array<[string, unknown]>,
): string[] {
  const aggFields: string[] = []
  for (const [fn, field] of aggEntries) {
    const lower = fn.toLowerCase()
    const column = String(field ?? '*')
    if (lower === 'count') {
      aggFields.push(`count { ${config.idField} }`)
      continue
    }
    const mapped = remapField(config, column === '*' ? config.idField : column)
    if (!isGqlName(mapped)) {
      throw new Error(`directusAggregate: invalid field "${column}"`)
    }
    if (!['sum', 'avg', 'min', 'max'].includes(lower)) {
      throw new Error(`directusAggregate: unsupported function "${fn}"`)
    }
    aggFields.push(`${lower} { ${mapped} }`)
  }
  return aggFields
}

function mapDirectusAggregateRow(
  config: DirectusEntityConfig,
  aggregate: Record<string, unknown>,
  aggEntries: Array<[string, unknown]>,
  groupFields: string[],
): Record<string, unknown> {
  const group = asObject(aggregate.group)
  const out: Record<string, unknown> = {}
  for (const field of groupFields) {
    const mapped = remapField(config, field)
    out[field] = group[field] ?? group[mapped] ?? aggregate[field] ?? null
  }
  for (const [fn, field] of aggEntries) {
    const lower = fn.toLowerCase()
    const key = String(field ?? '*') || '*'
    if (lower === 'count') {
      const bucket = asObject(aggregate.count)
      out[fn] = {
        [key]: Number(bucket[config.idField] ?? bucket.id ?? aggregate.countAll ?? 0),
      }
      continue
    }
    const mapped = remapField(config, key === '*' ? config.idField : key)
    const bucket = asObject(aggregate[lower])
    const num = Number(bucket[mapped] ?? 0)
    out[fn] = { [key]: Number.isNaN(num) ? 0 : num }
  }
  return out
}

const DIRECTUS_GROUP_PAGE = 1000
const DIRECTUS_GROUP_MAX_ROWS = 25_000

async function directusScanRows(
  collection: string,
  params: {
    filter?: Record<string, unknown> | null
    fields: string[]
  },
): Promise<Record<string, unknown>[]> {
  const nodes: Record<string, unknown>[] = []
  let offset = 0
  while (nodes.length < DIRECTUS_GROUP_MAX_ROWS) {
    const page = await directusFindMany(collection, {
      filter: params.filter ?? null,
      fields: params.fields,
      limit: DIRECTUS_GROUP_PAGE,
      offset,
      includeDeleted: false,
    })
    nodes.push(...page.nodes)
    if (page.nodes.length < DIRECTUS_GROUP_PAGE) break
    offset += DIRECTUS_GROUP_PAGE
    if (offset >= DIRECTUS_GROUP_MAX_ROWS) {
      throw new Error(
        `Directus aggregate groupBy exceeded ${DIRECTUS_GROUP_MAX_ROWS} matching rows for "${collection}"`,
      )
    }
  }
  return nodes
}

export async function directusAggregate(
  collection: string,
  options: RecordsAggregateOptions,
): Promise<Record<string, unknown>[]> {
  const aggEntries = Object.entries(options.aggregate)
  if (!aggEntries.length) {
    throw new Error('directusAggregate: at least one aggregate function is required')
  }

  const groupFields = (options.groupBy ?? []).filter(
    (field): field is string => Boolean(field),
  )
  const config = await resolveDirectusConfig(collection)

  if (groupFields.length) {
    try {
      const mappedGroups = groupFields.map((field) => remapField(config, field))
      for (const field of mappedGroups) {
        if (!isGqlName(field)) {
          throw new Error(`directusAggregate: invalid groupBy field "${field}"`)
        }
      }
      const aggFields = ['group', ...directusAggSelection(config, aggEntries)]
      const filter = compileFilter(config, options.filter ?? null, false)
      const parts: string[] = [`groupBy: ${graphqlLiteral(mappedGroups)}`]
      if (filter) parts.unshift(`filter: ${graphqlLiteral(filter)}`)
      const root = `${config.collection}_aggregated`
      const queryText = /* GraphQL */ `
        query DirectusAggregateGroup {
          ${root}(${parts.join(', ')}) {
            ${aggFields.join('\n            ')}
          }
        }
      `
      const data = await directusRequest<Record<string, unknown>>(
        queryText,
        undefined,
        config.endpoint ?? undefined,
      )
      const raw = data[root]
      const rows = Array.isArray(raw) ? raw : raw ? [raw] : []
      const mapped = rows.map((row) =>
        mapDirectusAggregateRow(config, asObject(row), aggEntries, groupFields),
      )
      const limit = options.limit ?? -1
      return limit >= 0 ? mapped.slice(0, limit) : mapped
    } catch {
      const nodes = await directusScanRows(collection, {
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
  }

  const aggFields = directusAggSelection(config, aggEntries)
  const filter = compileFilter(config, options.filter ?? null, false)
  const args = filter ? `(filter: ${graphqlLiteral(filter)})` : ''
  const root = `${config.collection}_aggregated`
  const queryText = /* GraphQL */ `
    query DirectusAggregate {
      ${root}${args} {
        ${aggFields.join('\n        ')}
      }
    }
  `
  const data = await directusRequest<Record<string, unknown>>(
    queryText,
    undefined,
    config.endpoint ?? undefined,
  )
  return [
    mapDirectusAggregateRow(config, firstAggregate(data[root]), aggEntries, []),
  ]
}
