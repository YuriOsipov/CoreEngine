import { randomUUID } from 'node:crypto'
import { query } from '../../../../db/pool.js'
import {
  coercePromotedValue,
  resolveRecordRelation,
  type CrmPromotedField,
  type CrmRecordRelation,
} from '../../../../schema/crmStorage.js'
import { formatUniqueViolationError } from '../../../../schema/uniqueGroups.js'
import type { RecordsListParams, RecordsListResult } from '../../types.js'

interface BusinessRecordRow {
  record_id: string
  status: string
  data: Record<string, unknown>
  created_at: string
  updated_at: string
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function projectFields(
  row: Record<string, unknown>,
  fields?: string[] | null,
): Record<string, unknown> {
  if (!fields?.length) return row
  // `*` means "all physical fields" (Directus/Hasura-compatible). Nested
  // relation paths in the same list are still used later by expandM2O.
  if (fields.some((field) => field === '*' || field === '*.*')) return row
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const base = field.split(/[.:(]/)[0] ?? field
    if (base in row) out[base] = row[base]
  }
  if (!('id' in out) && 'id' in row) out.id = row.id
  return out
}

function toPublicRecord(
  row: BusinessRecordRow,
  fields?: string[] | null,
): Record<string, unknown> {
  const data = asObject(row.data)
  const merged: Record<string, unknown> = {
    ...data,
    id: row.record_id,
    status: row.status,
    date_created: data.date_created ?? row.created_at,
    date_updated: data.date_updated ?? row.updated_at,
  }
  return projectFields(merged, fields)
}

type SqlFragment = { sql: string; params: unknown[] }

function jsonFieldExpr(field: string): string {
  // Top-level scalar compare against jsonb text extraction.
  return `data->>${quoteLiteral(field)}`
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function compileFilter(
  filter: unknown,
  startIndex: number,
): SqlFragment | null {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return null
  const entries = Object.entries(filter as Record<string, unknown>)
  if (entries.length === 0) return null

  const parts: string[] = []
  const params: unknown[] = []
  // `index` is the next free 1-based placeholder; advance it as params grow so
  // that sequential fragments (and compound _and/_or children) never collide.
  let index = startIndex

  const consume = (frag: SqlFragment | null): void => {
    if (!frag) return
    parts.push(frag.sql)
    params.push(...frag.params)
    index += frag.params.length
  }

  for (const [key, value] of entries) {
    if ((key === '_and' || key === '_or') && Array.isArray(value)) {
      const childSql: string[] = []
      for (const child of value) {
        const frag = compileFilter(child, index)
        if (!frag) continue
        childSql.push(`(${frag.sql})`)
        params.push(...frag.params)
        index += frag.params.length
      }
      if (childSql.length) {
        const joiner = key === '_or' ? ' OR ' : ' AND '
        parts.push(`(${childSql.join(joiner)})`)
      }
      continue
    }

    if (key === 'id') {
      consume(compileComparison('record_id', value, index, false))
      continue
    }

    if (key === 'status') {
      consume(compileComparison('status', value, index, false))
      continue
    }

    consume(compileComparison(key, value, index, true))
  }

  if (!parts.length) return null
  return { sql: parts.join(' AND '), params }
}

function compileComparison(
  field: string,
  value: unknown,
  startIndex: number,
  jsonb: boolean,
): SqlFragment | null {
  const column = jsonb ? jsonFieldExpr(field) : field
  if (value === null) {
    return { sql: `${column} IS NULL`, params: [] }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { sql: `${column} = $${startIndex}`, params: [value] }
  }

  const ops = value as Record<string, unknown>
  const parts: string[] = []
  const params: unknown[] = []
  let index = startIndex

  for (const [op, raw] of Object.entries(ops)) {
    switch (op) {
      case '_eq':
        parts.push(`${column} = $${index}`)
        params.push(raw)
        index += 1
        break
      case '_neq':
        parts.push(`${column} <> $${index}`)
        params.push(raw)
        index += 1
        break
      case '_in':
        if (Array.isArray(raw) && raw.length) {
          parts.push(`${column} = ANY($${index}::text[])`)
          params.push(raw.map(String))
          index += 1
        }
        break
      case '_nin':
        if (Array.isArray(raw) && raw.length) {
          parts.push(`NOT (${column} = ANY($${index}::text[]))`)
          params.push(raw.map(String))
          index += 1
        }
        break
      case '_null':
        parts.push(raw ? `${column} IS NULL` : `${column} IS NOT NULL`)
        break
      case '_nnull':
        parts.push(raw ? `${column} IS NOT NULL` : `${column} IS NULL`)
        break
      case '_gt':
      case '_gte':
      case '_lt':
      case '_lte': {
        const sqlOp =
          op === '_gt' ? '>' : op === '_gte' ? '>=' : op === '_lt' ? '<' : '<='
        if (typeof raw === 'number') {
          const numericColumn = jsonb ? `(${column})::numeric` : column
          parts.push(`${numericColumn} ${sqlOp} $${index}`)
          params.push(raw)
        } else {
          parts.push(`${column} ${sqlOp} $${index}`)
          params.push(raw)
        }
        index += 1
        break
      }
      case '_contains':
      case '_icontains':
        parts.push(`${column} ILIKE $${index}`)
        params.push(`%${String(raw)}%`)
        index += 1
        break
      case '_starts_with':
        parts.push(`${column} ILIKE $${index}`)
        params.push(`${String(raw)}%`)
        index += 1
        break
      default:
        break
    }
  }

  if (!parts.length) return null
  return { sql: parts.join(' AND '), params }
}

function compileSort(sort?: string[] | null): string {
  if (!sort?.length) return 'updated_at DESC'
  const clauses: string[] = []
  for (const entry of sort) {
    const desc = entry.startsWith('-')
    const field = desc ? entry.slice(1) : entry
    if (!field) continue
    if (field === 'id') {
      clauses.push(`record_id ${desc ? 'DESC' : 'ASC'}`)
      continue
    }
    if (field === 'status') {
      clauses.push(`status ${desc ? 'DESC' : 'ASC'}`)
      continue
    }
    if (field === 'date_updated' || field === 'updated_at') {
      clauses.push(`updated_at ${desc ? 'DESC' : 'ASC'}`)
      continue
    }
    if (field === 'date_created' || field === 'created_at') {
      clauses.push(`created_at ${desc ? 'DESC' : 'ASC'}`)
      continue
    }
    clauses.push(`data->>${quoteLiteral(field)} ${desc ? 'DESC' : 'ASC'}`)
  }
  return clauses.length ? clauses.join(', ') : 'updated_at DESC'
}

function buildEntityWhere(
  relation: CrmRecordRelation,
  collection: string,
): { where: string[]; sqlParams: unknown[]; next: number } {
  if (relation.needsEntityFilter) {
    return {
      where: ['entity_api_name = $1'],
      sqlParams: [collection],
      next: 2,
    }
  }
  return { where: [], sqlParams: [], next: 1 }
}

async function runWrite<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    const uniqueMsg = formatUniqueViolationError(err)
    if (uniqueMsg) throw new Error(uniqueMsg)
    throw err
  }
}

function promotedWriteFragments(
  promoted: CrmPromotedField[],
  payload: Record<string, unknown>,
  startIndex: number,
): { columns: string[]; placeholders: string[]; values: unknown[]; next: number } {
  const columns: string[] = []
  const placeholders: string[] = []
  const values: unknown[] = []
  let index = startIndex
  for (const field of promoted) {
    columns.push(`"${field.apiName.replace(/"/g, '""')}"`)
    if (field.pgType === 'jsonb') {
      placeholders.push(`$${index}::jsonb`)
    } else {
      placeholders.push(`$${index}`)
    }
    values.push(coercePromotedValue(field, payload[field.apiName]))
    index += 1
  }
  return { columns, placeholders, values, next: index }
}

export async function postgresFindMany(
  collection: string,
  params: RecordsListParams = {},
): Promise<RecordsListResult> {
  const relation = await resolveRecordRelation(collection)
  const base = buildEntityWhere(relation, collection)
  const where = [...base.where]
  const sqlParams = [...base.sqlParams]
  let next = base.next

  if (!params.includeDeleted) {
    where.push(`status <> 'archived'`)
  }

  const filterFrag = compileFilter(params.filter, next)
  if (filterFrag) {
    where.push(`(${filterFrag.sql})`)
    sqlParams.push(...filterFrag.params)
    next += filterFrag.params.length
  }

  if (params.search?.trim()) {
    where.push(`data::text ILIKE $${next}`)
    sqlParams.push(`%${params.search.trim()}%`)
    next += 1
  }

  const whereSql = where.length ? where.join(' AND ') : 'TRUE'
  const limit = params.limit ?? 50
  const offset = params.offset ?? 0
  const orderSql = compileSort(params.sort)

  const countRows = await query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM ${relation.relationSql}
     WHERE ${whereSql}`,
    sqlParams,
  )

  const rows = await query<BusinessRecordRow>(
    `SELECT record_id, status, data, created_at::text, updated_at::text
     FROM ${relation.relationSql}
     WHERE ${whereSql}
     ORDER BY ${orderSql}
     LIMIT $${next} OFFSET $${next + 1}`,
    [...sqlParams, limit < 0 ? null : limit, offset],
  )

  // LIMIT NULL means all rows in Postgres.
  return {
    nodes: rows.map((row) => toPublicRecord(row, params.fields)),
    totalCount: Number(countRows[0]?.count ?? 0),
  }
}

export async function postgresFindOne(
  collection: string,
  id: string,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const relation = await resolveRecordRelation(collection)
  const base = buildEntityWhere(relation, collection)
  const where = [...base.where, `record_id = $${base.next}`]
  const sqlParams = [...base.sqlParams, id]

  const rows = await query<BusinessRecordRow>(
    `SELECT record_id, status, data, created_at::text, updated_at::text
     FROM ${relation.relationSql}
     WHERE ${where.join(' AND ')}
     LIMIT 1`,
    sqlParams,
  )
  const row = rows[0]
  if (!row) throw new Error(`Record not found: ${collection}/${id}`)
  return toPublicRecord(row, fields)
}

export async function postgresCreate(
  collection: string,
  data: Record<string, unknown>,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const relation = await resolveRecordRelation(collection)
  const recordId = data.id == null || data.id === '' ? randomUUID() : String(data.id)
  const status =
    typeof data.status === 'string' && data.status.trim()
      ? data.status.trim()
      : 'published'
  const payload = { ...data }
  delete payload.id
  delete payload.status

  if (relation.storage === 'typed') {
    const promoted = promotedWriteFragments(relation.promoted, payload, 4)
    const colSql = ['record_id', 'status', 'data', ...promoted.columns].join(', ')
    const valSql = [
      '$1',
      '$2',
      '$3::jsonb',
      ...promoted.placeholders,
    ].join(', ')
    await runWrite(() =>
      query(
        `INSERT INTO ${relation.relationSql} (${colSql})
         VALUES (${valSql})`,
        [recordId, status, JSON.stringify(payload), ...promoted.values],
      ),
    )
  } else {
    await runWrite(() =>
      query(
        `INSERT INTO public.business_records (entity_api_name, record_id, status, data)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [collection, recordId, status, JSON.stringify(payload)],
      ),
    )
  }

  return postgresFindOne(collection, recordId, fields)
}

export async function postgresUpdate(
  collection: string,
  id: string,
  data: Record<string, unknown>,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const relation = await resolveRecordRelation(collection)
  const base = buildEntityWhere(relation, collection)
  const findWhere = [...base.where, `record_id = $${base.next}`]
  const findParams = [...base.sqlParams, id]

  const existing = await query<BusinessRecordRow>(
    `SELECT record_id, status, data, created_at::text, updated_at::text
     FROM ${relation.relationSql}
     WHERE ${findWhere.join(' AND ')}
     LIMIT 1`,
    findParams,
  )
  const row = existing[0]
  if (!row) throw new Error(`Record not found: ${collection}/${id}`)

  const current = asObject(row.data)
  const merged = { ...current, ...data }
  delete merged.id
  const status =
    typeof data.status === 'string' && data.status.trim()
      ? data.status.trim()
      : row.status
  delete merged.status

  if (relation.storage === 'typed') {
    const promoted = promotedWriteFragments(relation.promoted, merged, 3)
    const setParts = [
      'status = $1',
      'data = $2::jsonb',
      'updated_at = now()',
      ...promoted.columns.map((col, i) => `${col} = ${promoted.placeholders[i]}`),
    ]
    await runWrite(() =>
      query(
        `UPDATE ${relation.relationSql}
         SET ${setParts.join(', ')}
         WHERE record_id = $${promoted.next}`,
        [status, JSON.stringify(merged), ...promoted.values, id],
      ),
    )
  } else {
    await runWrite(() =>
      query(
        `UPDATE public.business_records
         SET status = $3, data = $4::jsonb, updated_at = now()
         WHERE entity_api_name = $1 AND record_id = $2`,
        [collection, id, status, JSON.stringify(merged)],
      ),
    )
  }

  return postgresFindOne(collection, id, fields)
}

export async function postgresSoftDelete(
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  return postgresUpdate(collection, id, { status: 'archived' })
}

export async function postgresRestore(
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  return postgresUpdate(collection, id, { status: 'published' })
}

export async function postgresHardDelete(
  collection: string,
  id: string,
): Promise<boolean> {
  const relation = await resolveRecordRelation(collection)
  if (relation.storage === 'typed') {
    await query(`DELETE FROM ${relation.relationSql} WHERE record_id = $1`, [id])
  } else {
    await query(
      `DELETE FROM public.business_records
       WHERE entity_api_name = $1 AND record_id = $2`,
      [collection, id],
    )
  }
  return true
}

/** SQL expression to read a groupable field (special columns or JSONB scalar). */
function groupExpr(field: string): string {
  if (field === 'id') return 'record_id'
  if (field === 'status') return 'status'
  if (field === 'date_created' || field === 'created_at') return 'created_at::text'
  if (field === 'date_updated' || field === 'updated_at') return 'updated_at::text'
  return `data->>${quoteLiteral(field)}`
}

/** SQL expression for an aggregate function over a field. */
function aggregateExpr(fn: string, field: string): string {
  const lower = fn.toLowerCase()
  if (lower === 'count') {
    if (!field || field === '*') return 'count(*)'
    if (field === 'id') return 'count(record_id)'
    if (field === 'status') return 'count(status)'
    return `count(data->>${quoteLiteral(field)})`
  }
  const numeric = `NULLIF(data->>${quoteLiteral(field)}, '')::numeric`
  switch (lower) {
    case 'sum':
      return `sum(${numeric})`
    case 'avg':
      return `avg(${numeric})`
    case 'min':
      return `min(${numeric})`
    case 'max':
      return `max(${numeric})`
    default:
      throw new Error(`postgresAggregate: unsupported function "${fn}"`)
  }
}

export async function postgresAggregate(
  collection: string,
  options: {
    aggregate: Record<string, unknown>
    groupBy?: string[] | null
    filter?: Record<string, unknown> | null
    limit?: number
  },
): Promise<Record<string, unknown>[]> {
  const relation = await resolveRecordRelation(collection)
  const base = buildEntityWhere(relation, collection)
  const where = [...base.where, `status <> 'archived'`]
  const sqlParams = [...base.sqlParams]
  const filterFrag = compileFilter(options.filter, base.next)
  if (filterFrag) {
    where.push(`(${filterFrag.sql})`)
    sqlParams.push(...filterFrag.params)
  }

  const aggEntries = Object.entries(options.aggregate)
  if (!aggEntries.length) {
    throw new Error('postgresAggregate: at least one aggregate function is required')
  }
  const groupFields = (options.groupBy ?? []).filter(
    (field): field is string => Boolean(field),
  )

  const selectParts: string[] = []
  groupFields.forEach((field, i) => {
    selectParts.push(`${groupExpr(field)} AS g${i}`)
  })
  aggEntries.forEach(([fn, field], i) => {
    selectParts.push(`${aggregateExpr(fn, String(field ?? '*'))}::text AS a${i}`)
  })

  const groupBySql = groupFields.length
    ? ` GROUP BY ${groupFields.map((field) => groupExpr(field)).join(', ')}`
    : ''

  // limit -1 means "all"; only cap when a positive limit is given.
  const limit = options.limit ?? -1
  let limitSql = ''
  if (groupFields.length && limit >= 0) {
    sqlParams.push(limit)
    limitSql = ` LIMIT $${sqlParams.length}`
  }

  const rows = await query<Record<string, string | null>>(
    `SELECT ${selectParts.join(', ')}
     FROM ${relation.relationSql}
     WHERE ${where.join(' AND ')}${groupBySql}${limitSql}`,
    sqlParams,
  )

  const toNumber = (raw: string | null): number => {
    if (raw == null) return 0
    const num = Number(raw)
    return Number.isNaN(num) ? 0 : num
  }

  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    groupFields.forEach((field, i) => {
      out[field] = row[`g${i}`] ?? null
    })
    aggEntries.forEach(([fn, field], i) => {
      const key = String(field ?? '*') || '*'
      out[fn] = { [key]: toNumber(row[`a${i}`]) }
    })
    return out
  })
}
