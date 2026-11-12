import { randomUUID } from 'node:crypto'
import { query } from '../../../../db/pool.js'
import {
  coercePromotedValue,
  loadPromotedFields,
  quoteIdent,
  resolveRecordRelation,
  type CrmPromotedField,
  type CrmRecordRelation,
} from '../../../../schema/crmStorage.js'
import { formatUniqueViolationError } from '../../../../schema/uniqueGroups.js'
import { filterM2OSearchLabelFields } from '../../m2oSearchAccess.js'
import { loadM2ORelations } from '../../relations.js'
import type { MeUser } from '../../../usersAdapter.js'
import type { RecordsListParams, RecordsListResult } from '../../types.js'

interface BusinessRecordRow {
  record_id: string
  status?: string | null
  is_deleted?: boolean | null
  is_active?: boolean | null
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
  const keys = Object.keys(row)
  for (const field of fields) {
    const base = field.split(/[.:(]/)[0] ?? field
    if (!base || base in out) continue
    if (base in row) {
      out[base] = row[base]
      continue
    }
    const needle = normalizeFieldKey(base)
    const match = keys.find((key) => normalizeFieldKey(key) === needle)
    if (match && !(match in out)) out[match] = row[match]
  }
  if (!('id' in out) && 'id' in row) out.id = row.id
  return out
}

function readBool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 1 || value === '1' || value === 'true') return true
  if (value === false || value === 0 || value === '0' || value === 'false') return false
  return fallback
}

function selectColumns(relation: CrmRecordRelation): string {
  const cols = ['record_id']
  if (relation.hasStatus) cols.push('status')
  if (relation.hasDeleted) cols.push('is_deleted')
  if (relation.hasActive) cols.push('is_active')
  cols.push('data', 'created_at::text', 'updated_at::text')
  // Typed promoted columns are authoritative over stale JSONB mirrors.
  for (const field of relation.promoted) {
    cols.push(quoteIdent(field.apiName))
  }
  return cols.join(', ')
}

function toPublicRecord(
  row: BusinessRecordRow,
  relation: CrmRecordRelation,
  fields?: string[] | null,
): Record<string, unknown> {
  const data = asObject(row.data)
  const rowBag = row as BusinessRecordRow & Record<string, unknown>
  const merged: Record<string, unknown> = {
    ...data,
    id: row.record_id,
    // Envelope timestamps always win — JSONB date_* mirrors go stale on update.
    date_created: row.created_at ?? data.date_created ?? null,
    date_updated: row.updated_at ?? data.date_updated ?? null,
  }
  for (const field of relation.promoted) {
    if (!Object.prototype.hasOwnProperty.call(rowBag, field.apiName)) continue
    const colVal = rowBag[field.apiName]
    // Prefer typed column when present; keep JSONB when column is still null (legacy).
    if (colVal !== null && colVal !== undefined) {
      merged[field.apiName] = colVal
    }
  }
  if (relation.hasStatus) merged.status = row.status ?? null
  else delete merged.status
  if (relation.hasDeleted) merged.is_deleted = row.is_deleted === true
  else delete merged.is_deleted
  if (relation.hasActive) merged.is_active = row.is_active !== false
  else delete merged.is_active
  return projectFields(merged, fields)
}

function envelopeAssignments(
  relation: CrmRecordRelation,
  data: Record<string, unknown>,
  existing?: BusinessRecordRow,
): { columns: string[]; values: unknown[]; payload: Record<string, unknown> } {
  const payload = { ...data }
  delete payload.id
  const columns: string[] = []
  const values: unknown[] = []
  if (relation.hasStatus) {
    const next =
      typeof payload.status === 'string' && payload.status.trim()
        ? payload.status.trim()
        : existing?.status || 'published'
    columns.push('status')
    values.push(next)
    delete payload.status
  }
  if (relation.hasDeleted) {
    columns.push('is_deleted')
    values.push(
      payload.is_deleted === undefined && existing
        ? existing.is_deleted === true
        : readBool(payload.is_deleted, false),
    )
    delete payload.is_deleted
  }
  if (relation.hasActive) {
    columns.push('is_active')
    values.push(
      payload.is_active === undefined && existing
        ? existing.is_active !== false
        : readBool(payload.is_active, true),
    )
    delete payload.is_active
  }
  return { columns, values, payload }
}

type SqlFragment = { sql: string; params: unknown[] }

const FILTER_COMPARISON_OPS = new Set([
  '_eq',
  '_neq',
  '_in',
  '_nin',
  '_null',
  '_nnull',
  '_gt',
  '_gte',
  '_lt',
  '_lte',
  '_contains',
  '_icontains',
  '_starts_with',
])

function jsonFieldExpr(field: string): string {
  // Top-level scalar compare against jsonb text extraction.
  return `data->>${quoteLiteral(field)}`
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function isComparisonFilterValue(value: unknown): boolean {
  if (value === null) return true
  if (typeof value !== 'object' || Array.isArray(value)) return true
  return Object.keys(value as Record<string, unknown>).some((key) =>
    FILTER_COMPARISON_OPS.has(key),
  )
}

/**
 * Compile a Directus-style filter, including one-hop nested M2O paths such as
 * `{ item: { item_group: { _eq: id } } }` or dotted keys `item.item_group`.
 */
async function compileFilter(
  collection: string,
  relation: CrmRecordRelation,
  filter: unknown,
  startIndex: number,
): Promise<SqlFragment | null> {
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
        const frag = await compileFilter(collection, relation, child, index)
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

    if (key.includes('.')) {
      const [root, ...rest] = key.split('.').map((part) => part.trim()).filter(Boolean)
      if (root && rest.length) {
        consume(
          await compileM2ORelationFilter(
            collection,
            relation,
            root,
            { [rest.join('.')]: value },
            index,
          ),
        )
      }
      continue
    }

    if (key === 'id') {
      consume(compileComparison('record_id', value, index, false))
      continue
    }

    if (key === 'status' || key === 'is_deleted' || key === 'is_active') {
      consume(compileComparison(key, value, index, false))
      continue
    }

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !isComparisonFilterValue(value)
    ) {
      consume(
        await compileM2ORelationFilter(
          collection,
          relation,
          key,
          value as Record<string, unknown>,
          index,
        ),
      )
      continue
    }

    const promoted = findPromotedField(relation, key)
    if (promoted) {
      consume(compileComparison(quoteIdent(promoted.apiName), value, index, false))
      continue
    }

    consume(compileComparison(key, value, index, true))
  }

  if (!parts.length) return null
  return { sql: parts.join(' AND '), params }
}

async function compileM2ORelationFilter(
  collection: string,
  parentRelation: CrmRecordRelation,
  fieldApiName: string,
  nestedFilter: Record<string, unknown>,
  startIndex: number,
): Promise<SqlFragment | null> {
  const m2oRels = await loadM2ORelations(collection)
  const m2o = m2oRels.find(
    (rel) => normalizeFieldKey(rel.fieldApiName) === normalizeFieldKey(fieldApiName),
  )
  if (!m2o) return null

  const relatedRelation = await resolveRecordRelation(m2o.relatedEntityApiName)
  const fkExpr = parentFkExpr(parentRelation, m2o.fieldApiName)
  const entityFilter = relatedRelation.needsEntityFilter
    ? ` AND r.entity_api_name = ${quoteLiteral(m2o.relatedEntityApiName)}`
    : ''

  const inner = await compileAliasedFilter(
    m2o.relatedEntityApiName,
    relatedRelation,
    nestedFilter,
    startIndex,
    'r',
  )
  if (!inner) return null

  return {
    sql:
      `EXISTS (SELECT 1 FROM ${relatedRelation.relationSql} r ` +
      `WHERE r.record_id::text = (${fkExpr})::text${entityFilter} AND (${inner.sql}))`,
    params: inner.params,
  }
}

/** Filter clauses scoped to a related-table alias (for EXISTS subqueries). */
async function compileAliasedFilter(
  _collection: string,
  relation: CrmRecordRelation,
  filter: unknown,
  startIndex: number,
  alias: string,
): Promise<SqlFragment | null> {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return null
  const entries = Object.entries(filter as Record<string, unknown>)
  if (entries.length === 0) return null

  const parts: string[] = []
  const params: unknown[] = []
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
        const frag = await compileAliasedFilter(
          _collection,
          relation,
          child,
          index,
          alias,
        )
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

    // One-hop tree filters only need scalar compares on the related row
    // (e.g. item_group._eq). Deeper relation nesting is handled at the root.
    if (key === 'id') {
      consume(compileComparison(`${alias}.record_id`, value, index, false))
      continue
    }
    if (key === 'status' && relation.hasStatus) {
      consume(compileComparison(`${alias}.status`, value, index, false))
      continue
    }
    if (key === 'is_deleted' && relation.hasDeleted) {
      consume(compileComparison(`${alias}.is_deleted`, value, index, false))
      continue
    }
    if (key === 'is_active' && relation.hasActive) {
      consume(compileComparison(`${alias}.is_active`, value, index, false))
      continue
    }

    const fieldName = key.includes('.') ? (key.split('.')[0] ?? key) : key
    const promoted = findPromotedField(relation, fieldName)
    if (promoted) {
      consume(
        compileComparison(
          `${alias}.${quoteIdent(promoted.apiName)}`,
          value,
          index,
          false,
        ),
      )
      continue
    }

    consume(
      compileComparison(
        `${alias}.data->>${quoteLiteral(fieldName)}`,
        value,
        index,
        false,
      ),
    )
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

function normalizeFieldKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function findPromotedField(
  relation: CrmRecordRelation,
  fieldApiName: string,
): CrmPromotedField | undefined {
  const needle = normalizeFieldKey(fieldApiName)
  return relation.promoted.find((field) => normalizeFieldKey(field.apiName) === needle)
}

function isNumericSortField(field: CrmPromotedField): boolean {
  const pg = field.pgType.toLowerCase()
  if (
    pg.includes('int') ||
    pg.includes('double') ||
    pg.includes('real') ||
    pg.includes('numeric') ||
    pg.includes('decimal') ||
    pg === 'money'
  ) {
    return true
  }
  const ft = field.fieldType.toUpperCase()
  return (
    ft === 'INTEGER' ||
    ft === 'FLOAT' ||
    ft === 'DECIMAL' ||
    ft === 'BIGINTEGER'
  )
}

/** Numbers / dates / booleans must not be ORDER BY …::text (lexicographic). */
function isNativeSortField(field: CrmPromotedField): boolean {
  if (isNumericSortField(field)) return true
  const pg = field.pgType.toLowerCase()
  return (
    pg === 'boolean' ||
    pg === 'date' ||
    pg.includes('timestamp') ||
    pg.includes('time')
  )
}

function promotedSortExpr(promoted: CrmPromotedField, alias?: string): string {
  const col = alias
    ? `${alias}.${quoteIdent(promoted.apiName)}`
    : quoteIdent(promoted.apiName)
  if (promoted.pgType === 'jsonb') return `${col}::text`
  if (isNativeSortField(promoted)) return col
  return `${col}::text`
}

function jsonbSortExpr(
  fieldApiName: string,
  typeHint?: CrmPromotedField | null,
  alias?: string,
): string {
  const dataCol = alias ? `${alias}.data` : 'data'
  const textExpr = `${dataCol}->>${quoteLiteral(fieldApiName)}`
  if (!typeHint) return textExpr
  if (isNumericSortField(typeHint)) {
    return `NULLIF(${textExpr}, '')::numeric`
  }
  if (typeHint.pgType === 'boolean') return `(${textExpr})::boolean`
  if (typeHint.pgType === 'date') return `(${textExpr})::date`
  if (typeHint.pgType.toLowerCase().includes('timestamp')) {
    return `(${textExpr})::timestamptz`
  }
  return textExpr
}

/** FK scalar on the current list row (promoted column preferred). */
function parentFkExpr(relation: CrmRecordRelation, fieldApiName: string): string {
  const promoted = findPromotedField(relation, fieldApiName)
  if (promoted) return quoteIdent(promoted.apiName)
  return jsonFieldExpr(fieldApiName)
}

/** Related-row sort expression (promoted column or jsonb path). */
function relatedSortExpr(
  relatedAlias: string,
  relatedRelation: CrmRecordRelation,
  relatedField: string,
): string {
  const root = relatedField.split('.')[0] ?? relatedField
  if (root === 'id') return `${relatedAlias}.record_id`
  if (root === 'status' && relatedRelation.hasStatus) return `${relatedAlias}.status`
  if (root === 'is_deleted' && relatedRelation.hasDeleted) {
    return `${relatedAlias}.is_deleted`
  }
  if (root === 'is_active' && relatedRelation.hasActive) return `${relatedAlias}.is_active`
  if (root === 'date_created' || root === 'created_at') {
    return `${relatedAlias}.created_at`
  }
  if (root === 'date_updated' || root === 'updated_at') {
    return `${relatedAlias}.updated_at`
  }
  const promoted = findPromotedField(relatedRelation, root)
  if (promoted) return promotedSortExpr(promoted, relatedAlias)
  return jsonbSortExpr(root, null, relatedAlias)
}

/** Extract `{{field}}` root field names from a display template. */
function displayTemplateFields(template: string | null | undefined): string[] {
  if (!template) return []
  const fields: string[] = []
  for (const match of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const token = (match[1] ?? '').trim()
    const root = token.split('.')[0]?.trim()
    if (root && !fields.includes(root)) fields.push(root)
  }
  return fields
}

const LIST_SEARCH_FIELD_CAP = 16

/** Text-like promoted scalars only — never M2O/FK columns. */
function isTextSearchField(field: CrmPromotedField): boolean {
  if (field.needsFkIndex) return false
  const pg = field.pgType.toLowerCase()
  if (
    pg === 'text' ||
    pg.startsWith('varchar') ||
    pg.startsWith('character') ||
    pg === 'citext'
  ) {
    return true
  }
  const ft = field.fieldType.toUpperCase()
  return ft === 'STRING' || ft === 'TEXT'
}

/**
 * Columns for list `search`: indexed non-FK text only (Setup → Indexed).
 * Cap matches Hasura's search-field limit (shared with opt-in M2O slots).
 */
function pickListSearchFields(relation: CrmRecordRelation): CrmPromotedField[] {
  return relation.promoted
    .filter(isTextSearchField)
    .filter((field) => field.needsBtreeIndex)
}

/** M2O FKs flagged Setup → Use in search (related Display Template). */
function pickM2OSearchFields(relation: CrmRecordRelation): CrmPromotedField[] {
  return relation.promoted.filter(
    (field) =>
      field.needsFkIndex &&
      field.useInSearch &&
      Boolean(field.relatedEntityApiName),
  )
}

/**
 * Correlated EXISTS: related row Display Template (or name/title/label) ILIKE q.
 * Reuses the join shape from m2oSortSubquery. Respects related-entity ACL and
 * field sensitivity on template / fallback label columns.
 */
async function m2oSearchExistsSql(
  parentRelation: CrmRecordRelation,
  field: CrmPromotedField,
  patternIndex: number,
  me: MeUser | null | undefined,
): Promise<SqlFragment | null> {
  const relatedEntityApiName = field.relatedEntityApiName
  if (!relatedEntityApiName) return null

  const relatedRelation = await resolveRecordRelation(relatedEntityApiName)
  const fkExpr = parentFkExpr(parentRelation, field.apiName)
  const entityFilter = relatedRelation.needsEntityFilter
    ? ` AND r.entity_api_name = ${quoteLiteral(relatedEntityApiName)}`
    : ''

  const templateFields = displayTemplateFields(relatedRelation.displayTemplate)
  // Related-entity ACL + unreadable fields via resolveFieldAccess / assertMeEntityPermission.
  const labelFields = await filterM2OSearchLabelFields(me, relatedEntityApiName, [
    ...new Set([...templateFields, 'name', 'title', 'label']),
  ])
  if (!labelFields?.length) return null
  const ilikeParts = labelFields.map(
    (labelField) =>
      `${relatedSortExpr('r', relatedRelation, labelField)} ILIKE $${patternIndex}`,
  )
  if (!ilikeParts.length) return null

  return {
    sql: `EXISTS (
      SELECT 1
      FROM ${relatedRelation.relationSql} r
      WHERE r.record_id::text = (${fkExpr})::text${entityFilter}
        AND (${ilikeParts.join(' OR ')})
    )`,
    params: [],
  }
}

/**
 * OR of indexed parent text ILIKE + opt-in M2O Display Template EXISTS;
 * null when nothing to search.
 */
async function compileListSearch(
  relation: CrmRecordRelation,
  search: string,
  startIndex: number,
  excludeFields?: string[] | null,
  me?: MeUser | null,
): Promise<SqlFragment | null> {
  const q = search.trim()
  if (!q) return null

  const exclude = new Set(excludeFields ?? [])
  const searchable = (field: CrmPromotedField) => !exclude.has(field.apiName)
  const textFields = pickListSearchFields(relation).filter(searchable)
  const m2oFields = pickM2OSearchFields(relation).filter(searchable)
  const slots = LIST_SEARCH_FIELD_CAP
  const textTake = Math.min(textFields.length, slots)
  const m2oTake = Math.min(m2oFields.length, Math.max(0, slots - textTake))
  const texts = textFields.slice(0, textTake)
  const m2os = m2oFields.slice(0, m2oTake)
  if (!texts.length && !m2os.length) return null

  const pattern = `%${q}%`
  const parts: string[] = []
  const params: unknown[] = []
  let index = startIndex

  for (const field of texts) {
    parts.push(`${quoteIdent(field.apiName)} ILIKE $${index}`)
    params.push(pattern)
    index += 1
  }

  for (const field of m2os) {
    const existsFrag = await m2oSearchExistsSql(relation, field, index, me)
    if (!existsFrag) continue
    parts.push(existsFrag.sql)
    params.push(pattern)
    index += 1
  }

  if (!parts.length) return null
  return {
    sql: `(${parts.join(' OR ')})`,
    params,
  }
}

/**
 * Sort by a related M2O label via correlated subquery.
 * UI sends paths like `group.name`; bare `group` sorts by the related entity's
 * Display Template fields (authoritative label), falling back to name/title/label.
 */
async function m2oSortSubquery(
  parentRelation: CrmRecordRelation,
  fkField: string,
  relatedEntityApiName: string,
  relatedField: string | null,
): Promise<string | null> {
  const relatedRelation = await resolveRecordRelation(relatedEntityApiName)
  const fkExpr = parentFkExpr(parentRelation, fkField)
  const entityFilter = relatedRelation.needsEntityFilter
    ? ` AND r.entity_api_name = ${quoteLiteral(relatedEntityApiName)}`
    : ''

  // Bare M2O (no explicit nested field): sort by the related entity's Display
  // Template so the sort matches the rendered label (e.g. `{{description}}`),
  // not a raw `name` code column.
  const templateFields = relatedField ? [] : displayTemplateFields(relatedRelation.displayTemplate)
  const labelFields = relatedField
    ? [relatedField]
    : [...templateFields, 'name', 'title', 'label']

  const exprs = labelFields.map((field) => relatedSortExpr('r', relatedRelation, field))
  const orderExpr = relatedField
    ? exprs[0]
    : `COALESCE(${[...exprs, 'r.record_id::text'].join(', ')})`

  return `(SELECT ${orderExpr}
    FROM ${relatedRelation.relationSql} r
    WHERE r.record_id::text = (${fkExpr})::text${entityFilter}
    LIMIT 1)`
}

async function compileSort(
  collection: string,
  relation: CrmRecordRelation,
  sort?: string[] | null,
): Promise<string> {
  if (!sort?.length) return 'updated_at DESC'

  const m2oRels = await loadM2ORelations(collection)
  const m2oByField = new Map(
    m2oRels.map((rel) => [normalizeFieldKey(rel.fieldApiName), rel] as const),
  )

  // Jsonb storage has no promoted columns; still need registry types for numeric ORDER BY.
  let jsonbTypeByField: Map<string, CrmPromotedField> | null = null
  const jsonbFieldType = async (
    fieldApiName: string,
  ): Promise<CrmPromotedField | undefined> => {
    if (relation.storage !== 'jsonb') return undefined
    if (!jsonbTypeByField) {
      const fields = await loadPromotedFields(collection)
      jsonbTypeByField = new Map(
        fields.map((field) => [normalizeFieldKey(field.apiName), field] as const),
      )
    }
    return jsonbTypeByField.get(normalizeFieldKey(fieldApiName))
  }

  const clauses: string[] = []
  for (const entry of sort) {
    const desc = entry.startsWith('-')
    const field = desc ? entry.slice(1) : entry
    const dir = desc ? 'DESC' : 'ASC'
    if (!field) continue

    if (field === 'id') {
      clauses.push(`record_id ${dir}`)
      continue
    }
    if (field === 'status' || field === 'is_deleted' || field === 'is_active') {
      clauses.push(`${field} ${dir}`)
      continue
    }
    if (field === 'date_updated' || field === 'updated_at') {
      clauses.push(`updated_at ${dir}`)
      continue
    }
    if (field === 'date_created' || field === 'created_at') {
      clauses.push(`created_at ${dir}`)
      continue
    }

    const dot = field.indexOf('.')
    if (dot > 0) {
      const root = field.slice(0, dot)
      const nested = field.slice(dot + 1)
      const m2o = m2oByField.get(normalizeFieldKey(root))
      if (m2o && nested) {
        const sub = await m2oSortSubquery(
          relation,
          m2o.fieldApiName,
          m2o.relatedEntityApiName,
          nested,
        )
        if (sub) {
          clauses.push(`${sub} ${dir} NULLS LAST`)
          continue
        }
      }
    } else {
      const m2o = m2oByField.get(normalizeFieldKey(field))
      if (m2o) {
        const sub = await m2oSortSubquery(
          relation,
          m2o.fieldApiName,
          m2o.relatedEntityApiName,
          null,
        )
        if (sub) {
          clauses.push(`${sub} ${dir} NULLS LAST`)
          continue
        }
      }
    }

    const promoted = findPromotedField(relation, field)
    if (promoted) {
      clauses.push(`${promotedSortExpr(promoted)} ${dir} NULLS LAST`)
      continue
    }
    const typeHint = await jsonbFieldType(field)
    clauses.push(`${jsonbSortExpr(field, typeHint)} ${dir} NULLS LAST`)
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
    if (relation.hasDeleted) where.push(`is_deleted IS NOT TRUE`)
    else if (relation.hasStatus) where.push(`status <> 'archived'`)
  }

  const filterFrag = await compileFilter(collection, relation, params.filter, next)
  if (filterFrag) {
    where.push(`(${filterFrag.sql})`)
    sqlParams.push(...filterFrag.params)
    next += filterFrag.params.length
  }

  if (params.search?.trim()) {
    const searchFrag = await compileListSearch(
      relation,
      params.search,
      next,
      params.searchExcludeFields,
      params.access?.me,
    )
    if (searchFrag) {
      where.push(searchFrag.sql)
      sqlParams.push(...searchFrag.params)
      next += searchFrag.params.length
    }
  }

  const whereSql = where.length ? where.join(' AND ') : 'TRUE'
  // Hard ceiling even if callers pass limit < 0 (was LIMIT NULL = all rows).
  const HARD_MAX_LIMIT = 10_000
  const requested = params.limit ?? 50
  const limit =
    requested < 0 ? HARD_MAX_LIMIT : Math.min(Math.trunc(requested), HARD_MAX_LIMIT)
  const offset = params.offset ?? 0
  const orderSql = await compileSort(collection, relation, params.sort)

  const countRows = await query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM ${relation.relationSql}
     WHERE ${whereSql}`,
    sqlParams,
  )

  const rows = await query<BusinessRecordRow>(
    `SELECT ${selectColumns(relation)}
     FROM ${relation.relationSql}
     WHERE ${whereSql}
     ORDER BY ${orderSql}
     LIMIT $${next} OFFSET $${next + 1}`,
    [...sqlParams, limit, offset],
  )

  return {
    nodes: rows.map((row) => toPublicRecord(row, relation, params.fields)),
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
    `SELECT ${selectColumns(relation)}
     FROM ${relation.relationSql}
     WHERE ${where.join(' AND ')}
     LIMIT 1`,
    sqlParams,
  )
  const row = rows[0]
  if (!row) throw new Error(`Record not found: ${collection}/${id}`)
  return toPublicRecord(row, relation, fields)
}

export async function postgresCreate(
  collection: string,
  data: Record<string, unknown>,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const relation = await resolveRecordRelation(collection)
  const recordId = data.id == null || data.id === '' ? randomUUID() : String(data.id)
  const envelope = envelopeAssignments(relation, data)
  const leadColumns = relation.storage === 'typed' ? ['record_id'] : ['entity_api_name', 'record_id']
  const leadValues = relation.storage === 'typed' ? [recordId] : [collection, recordId]
  const dataIndex = leadValues.length + 1
  const promoted = promotedWriteFragments(
    relation.promoted,
    envelope.payload,
    dataIndex + 1 + envelope.values.length,
  )
  const columns = [
    ...leadColumns,
    'data',
    ...envelope.columns,
    ...promoted.columns,
  ]
  const placeholders = [
    ...leadValues.map((_, index) => `$${index + 1}`),
    `$${dataIndex}::jsonb`,
    ...envelope.values.map((_, index) => `$${dataIndex + 1 + index}`),
    ...promoted.placeholders,
  ]
  await runWrite(() =>
    query(
      `INSERT INTO ${relation.relationSql} (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})`,
      [...leadValues, JSON.stringify(envelope.payload), ...envelope.values, ...promoted.values],
    ),
  )

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
    `SELECT ${selectColumns(relation)}
     FROM ${relation.relationSql}
     WHERE ${findWhere.join(' AND ')}
     LIMIT 1`,
    findParams,
  )
  const row = existing[0]
  if (!row) throw new Error(`Record not found: ${collection}/${id}`)

  const current = asObject(row.data)
  const merged = { ...current, ...data }
  const envelope = envelopeAssignments(relation, merged, row)
  const promoted = promotedWriteFragments(
    relation.promoted,
    envelope.payload,
    2 + envelope.values.length,
  )
  const setParts = [
    'data = $1::jsonb',
    ...envelope.columns.map((col, index) => `${col} = $${index + 2}`),
    'updated_at = now()',
    ...promoted.columns.map((col, index) => `${col} = ${promoted.placeholders[index]}`),
  ]
  const idIndex = promoted.next
  const whereSql =
    relation.storage === 'typed'
      ? `record_id = $${idIndex}`
      : `entity_api_name = $${idIndex} AND record_id = $${idIndex + 1}`
  const whereParams = relation.storage === 'typed' ? [id] : [collection, id]
  await runWrite(() =>
    query(
      `UPDATE ${relation.relationSql}
       SET ${setParts.join(', ')}
       WHERE ${whereSql}`,
      [JSON.stringify(envelope.payload), ...envelope.values, ...promoted.values, ...whereParams],
    ),
  )

  return postgresFindOne(collection, id, fields)
}

export async function postgresSoftDelete(
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  const relation = await resolveRecordRelation(collection)
  if (relation.hasDeleted) return postgresUpdate(collection, id, { is_deleted: true })
  if (relation.hasStatus) return postgresUpdate(collection, id, { status: 'archived' })
  throw new Error(`Archive is not supported on "${collection}"`)
}

export async function postgresRestore(
  collection: string,
  id: string,
): Promise<Record<string, unknown>> {
  const relation = await resolveRecordRelation(collection)
  if (relation.hasDeleted) return postgresUpdate(collection, id, { is_deleted: false })
  if (relation.hasStatus) return postgresUpdate(collection, id, { status: 'published' })
  throw new Error(`Restore is not supported on "${collection}"`)
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
  if (field === 'status' || field === 'is_deleted' || field === 'is_active') return field
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
    if (field === 'status' || field === 'is_deleted' || field === 'is_active') {
      return `count(${field})`
    }
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
  const where = [...base.where]
  if (relation.hasDeleted) where.push(`is_deleted IS NOT TRUE`)
  else if (relation.hasStatus) where.push(`status <> 'archived'`)
  const sqlParams = [...base.sqlParams]
  const filterFrag = await compileFilter(
    collection,
    relation,
    options.filter,
    base.next,
  )
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
