import {
  applyFieldMapping,
  buildMappingResultFromRules,
  buildTemplateExport,
  isFieldMappingSpec,
  normalizeFieldMappingSpec,
  parseMappingResultToRules,
} from '@docengine/editor'

/** Normalized field-mapping config from `@docengine/editor` (type is no longer exported). */
export type FieldMappingSpec = ReturnType<typeof normalizeFieldMappingSpec>
import { formatDateValue } from '@/core/dateFormatting'
import { relatedCollectionForCollectionField } from '@/core/relationHelpers'
import { bridgeReadItem, bridgeReadItems } from '@/core/graphql/itemsBridge'
import { keysEqual } from '@/core/utils/object'
import { isUsersAssetCollection } from '@/core/usersField'
import type { RelationDefinition } from '@/interfaces'
import {
  fetchCollectionDisplayTemplate,
  fetchRelatedCollectionOptionById,
  getCachedCollectionFields,
  getCachedRelations,
  listParentRelatedCollections,
  type ParentRelatedCollectionRef,
} from '@/modules/entities/services/collectionSchema'
import { buildDocSourceSamplePayload } from '@/modules/documents/services/docSourceSamplePayload'
import {
  extractTemplateFields,
  formatUserLabel,
  relatedRecordDisplayField,
  renderTemplateLabel,
  shouldUseTemplateForRelatedLabel,
} from '@/modules/entities/utils/recordDisplay'

export {
  buildDocSourceSamplePayload,
  DOC_SOURCE_SAMPLE_MAX_DEPTH,
} from '@/modules/documents/services/docSourceSamplePayload'

export interface DocTemplateShape {
  blocks?: unknown[]
  fieldSchemas?: Record<string, unknown>
}

export function isDocFieldMappingResult(data: unknown): data is Record<string, unknown> {
  if (!data || typeof data !== 'object') return false
  const record = data as { kind?: string; sections?: unknown }
  return record.kind === 'field' && typeof record.sections === 'object' && record.sections !== null
}

/** Collects `$payload…` path strings from a stored mapping result. */
export function extractPayloadPaths(mapping: unknown): string[] {
  const paths = new Set<string>()
  collectPayloadPathStrings(mapping, paths)
  return [...paths]
    .map((path) => path.trim())
    .filter((path) => path.startsWith('$payload'))
    .map((path) => stripMappingFormatSuffix(path).replace(/^\$payload\.?/, ''))
    .filter(Boolean)
}

/**
 * DocEngine format suffix is `#dd/mm/yyyy` (hash). Also strip mistaken `|format`
 * so GraphQL field plans never request `date_visit_start|dd-mm-yy`.
 */
export function stripMappingFormatSuffix(sourcePath: string): string {
  const trimmed = sourcePath.trim()
  if (!trimmed) return trimmed

  const hash = trimmed.lastIndexOf('#')
  if (hash > 0) {
    const path = trimmed.slice(0, hash).trim()
    const format = trimmed.slice(hash + 1).trim()
    if (path && format) return path
  }

  const pipe = trimmed.lastIndexOf('|')
  if (pipe > 0 && trimmed.startsWith('$payload')) {
    const path = trimmed.slice(0, pipe).trim()
    const format = trimmed.slice(pipe + 1).trim()
    if (path && format && !format.includes('$')) return path
  }

  return trimmed
}

/**
 * Normalize mistaken `|format` delimiters to DocEngine's `#format`, and
 * uppercase common lowercase date token patterns (`dd-mm-yy` → `DD-MM-YY`).
 */
export function normalizeMappingFormatSuffixes(
  mapping: Record<string, unknown>,
): Record<string, unknown> {
  return rewriteMappingFormatValue(mapping) as Record<string, unknown>
}

function normalizeFormatSuffixToken(format: string): string {
  const raw = format.trim()
  if (!raw) return raw
  const lower = raw.toLowerCase()
  const aliases: Record<string, string> = {
    'dd-mm-yy': 'DD-MM-YY',
    'dd-mm-yyyy': 'DD-MM-YYYY',
    'dd/mm/yy': 'DD/MM/YY',
    'dd/mm/yyyy': 'dd/mm/yyyy',
    'mm/dd/yyyy': 'mm/dd/yyyy',
    'yyyy-mm-dd': 'yyyy-mm-dd',
    iso: 'iso',
  }
  if (aliases[lower]) return aliases[lower]
  // Lowercase custom token patterns → DocEngine uppercase tokens (YY/MM/DD/…)
  if (/[dmy]/.test(raw) && !/[DMY]/.test(raw)) {
    return raw
      .replace(/yyyy/gi, 'YYYY')
      .replace(/yy/gi, 'YY')
      .replace(/mmmm/gi, 'MMMM')
      .replace(/mmm/gi, 'MMM')
      .replace(/mm/gi, 'MM')
      .replace(/dd/gi, 'DD')
  }
  return raw
}

function normalizeMappingSourcePathFormat(value: string): string {
  const trimmed = value.trim()
  // Absolute `$payload…` and relative table items `$date_visit_start#…`.
  if (!trimmed.startsWith('$')) return value

  const pipe = trimmed.lastIndexOf('|')
  if (pipe > 0) {
    const path = trimmed.slice(0, pipe).trim()
    const format = trimmed.slice(pipe + 1).trim()
    if (path.startsWith('$') && format && !format.includes('$')) {
      return `${path}#${normalizeFormatSuffixToken(format)}`
    }
  }

  const hash = trimmed.lastIndexOf('#')
  if (hash > 0) {
    const path = trimmed.slice(0, hash).trim()
    const format = trimmed.slice(hash + 1).trim()
    if (path.startsWith('$') && format) {
      return `${path}#${normalizeFormatSuffixToken(format)}`
    }
  }

  return value
}

function splitMappingPathAndFormat(
  value: string,
): { path: string; format: string | null } {
  const trimmed = value.trim()
  if (!trimmed.startsWith('$')) return { path: trimmed, format: null }

  const hash = trimmed.lastIndexOf('#')
  if (hash > 0) {
    const path = trimmed.slice(0, hash).trim()
    const format = trimmed.slice(hash + 1).trim()
    if (path && format) return { path, format }
  }

  const pipe = trimmed.lastIndexOf('|')
  if (pipe > 0) {
    const path = trimmed.slice(0, pipe).trim()
    const format = trimmed.slice(pipe + 1).trim()
    if (path && format && !format.includes('$')) return { path, format }
  }

  return { path: trimmed, format: null }
}

function looksLikeDateMappingFormat(format: string): boolean {
  const raw = format.trim()
  if (!raw) return false
  const lower = raw.toLowerCase()
  if (
    lower === 'iso' ||
    lower === 'short' ||
    lower === 'long' ||
    lower === 'yyyy-mm-dd' ||
    lower === 'dd/mm/yyyy' ||
    lower === 'mm/dd/yyyy' ||
    lower === 'd mmm yyyy'
  ) {
    return true
  }
  return /[yY]{2,4}|[mM]{1,4}|[dD]{1,2}|H{1,2}|h{1,2}|s{1,2}/.test(raw)
}

/**
 * Pre-format row values for table `items` `#format` / `|format` suffixes using CRM
 * date formatting (supports time tokens). Strips the suffix so DocEngine receives
 * already-formatted strings — DocEngine only recognizes uppercase date tokens and
 * has no HH:mm support.
 */
function applyTableItemDateFormatsToRecords(
  mapping: Record<string, unknown>,
  records: Record<string, unknown>[],
): { mapping: Record<string, unknown>; records: Record<string, unknown>[] } {
  const formatsByField = new Map<string, string>()

  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map((entry) => visit(entry))
    if (!value || typeof value !== 'object') return value

    if (isTableMappingObject(value)) {
      const nextItems: Record<string, unknown> = {}
      for (const [columnKey, columnValue] of Object.entries(value.items)) {
        if (typeof columnValue !== 'string') {
          nextItems[columnKey] = columnValue
          continue
        }
        const { path, format } = splitMappingPathAndFormat(columnValue)
        if (format && looksLikeDateMappingFormat(format)) {
          const field = path.startsWith('$') ? path.slice(1) : path
          // Relative `$date_visit_start` or absolute `$payload.records.date_visit_start`
          const rowField = field.startsWith('payload.records.')
            ? field.slice('payload.records.'.length)
            : field.startsWith('payload.')
              ? field.slice('payload.'.length)
              : field
          if (rowField && !rowField.includes('.')) {
            formatsByField.set(rowField, format)
          }
          nextItems[columnKey] = path
          continue
        }
        nextItems[columnKey] = columnValue
      }
      return { ...value, items: nextItems }
    }

    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = visit(nested)
    }
    return out
  }

  const nextMapping = visit(mapping) as Record<string, unknown>
  if (formatsByField.size === 0) {
    return { mapping: nextMapping, records }
  }

  const nextRecords = records.map((row) => {
    let changed = false
    const next = { ...row }
    for (const [field, format] of formatsByField) {
      if (!(field in next) || next[field] == null || next[field] === '') continue
      const formatted = formatDateValue(next[field], format)
      if (formatted !== next[field]) {
        next[field] = formatted
        changed = true
      }
    }
    return changed ? next : row
  })

  return { mapping: nextMapping, records: nextRecords }
}

function rewriteMappingFormatValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return normalizeMappingSourcePathFormat(value)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteMappingFormatValue(entry))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = rewriteMappingFormatValue(nested)
    }
    return out
  }
  return value
}

/** DocEngine `{ source, items }` table mapping object. */
function isTableMappingObject(
  value: unknown,
): value is { source: string; items: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = (value as { source?: unknown }).source
  const items = (value as { items?: unknown }).items
  return (
    typeof source === 'string' &&
    source.startsWith('$') &&
    items != null &&
    typeof items === 'object' &&
    !Array.isArray(items)
  )
}

/**
 * Join table `source` with a relative (`$name`) or absolute (`$payload…`) item path.
 * Preserves `#format` / `|format` suffixes for later stripping.
 */
function toAbsoluteColumnPath(source: string, itemPath: string): string {
  const full = String(itemPath ?? '').trim()
  if (!full) return full

  const suffixMatch = full.match(/^(.*?)([#|][^#|]+)$/)
  const cleanItem = (suffixMatch ? suffixMatch[1] : full).trim()
  const formatSuffix = suffixMatch ? suffixMatch[2] : ''
  const arrayPath = String(source ?? '').trim()

  if (cleanItem.startsWith('$payload')) {
    return formatSuffix ? `${cleanItem}${formatSuffix}` : cleanItem
  }

  const relative = cleanItem.startsWith('$') ? cleanItem.slice(1) : cleanItem
  if (!arrayPath) {
    const abs = relative.startsWith('$') ? relative : `$${relative}`
    return formatSuffix ? `${abs}${formatSuffix}` : abs
  }

  const absolute = relative.startsWith('[')
    ? `${arrayPath}${relative}`
    : `${arrayPath}.${relative}`
  return formatSuffix ? `${absolute}${formatSuffix}` : absolute
}

function collectPayloadPathStrings(value: unknown, paths: Set<string>): void {
  if (typeof value === 'string') {
    if (value.trim().startsWith('$payload')) paths.add(value.trim())
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectPayloadPathStrings(item, paths)
    return
  }

  if (value && typeof value === 'object') {
    // DocEngine table schema: { source: "$payload.records", items: { name: "$name" } }
    // Relative item paths must be joined to absolute `$payload.records.*` for CRM fetches.
    if (isTableMappingObject(value)) {
      const source = String(value.source).trim()
      if (source.startsWith('$payload')) paths.add(source)
      for (const columnValue of Object.values(value.items)) {
        if (typeof columnValue !== 'string') continue
        const absolute = toAbsoluteColumnPath(source, columnValue).trim()
        if (absolute.startsWith('$payload')) paths.add(absolute)
      }
      return
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectPayloadPathStrings(nested, paths)
    }
  }
}

function addNestedFieldPaths(target: Set<string>, segments: string[]): void {
  if (segments.length === 0) return

  let acc = segments[0]
  target.add(acc)
  for (let index = 1; index < segments.length; index += 1) {
    acc = `${acc}.${segments[index]}`
    target.add(acc)
  }
}

interface PayloadFetchPlan {
  rootFields: string[]
  relatedFetches: Array<{
    relationKey: string
    relatedCollection: string
    parentFkField: string
    fields: string[]
  }>
}

function resolveParentFkField(
  relation: RelationDefinition,
  parentCollection: string,
): string | null {
  if (keysEqual(relation.related_collection ?? '', parentCollection)) {
    return relation.field ?? relation.meta?.many_field ?? null
  }

  if (keysEqual(relation.meta?.one_collection ?? '', parentCollection)) {
    return relation.meta?.many_field ?? relation.field ?? null
  }

  return null
}

function findO2MChildCollection(
  collection: string,
  fieldName: string,
  relations: RelationDefinition[],
): string | null {
  const relation = relations.find(
    (item) =>
      keysEqual(item.meta?.one_collection ?? '', collection) &&
      keysEqual(item.meta?.one_field ?? '', fieldName),
  )
  return relation?.meta?.many_collection ?? relation?.collection ?? null
}

interface TerminalM2OContext {
  fieldSet: Set<string>
  m2oField: string
  relatedCollection: string
}

function m2oRelatedCollection(
  relations: RelationDefinition[],
  collection: string,
  field: string,
): string {
  const fromRelation = relatedCollectionForCollectionField(
    relations,
    collection,
    field,
  )
  if (fromRelation) return fromRelation

  const direct = relations.find(
    (relation) =>
      keysEqual(relation.collection, collection) &&
      keysEqual(relation.field ?? '', field) &&
      Boolean(relation.related_collection),
  )
  return direct?.related_collection ?? ''
}

function resolveTerminalM2OContext(
  rootCollection: string,
  segments: string[],
  relations: RelationDefinition[],
  relatedByKey: Map<string, ParentRelatedCollectionRef>,
  rootFieldSet: Set<string>,
  relatedFieldSets: Map<string, Set<string>>,
): TerminalM2OContext | null {
  if (segments.length === 0) return null

  let collection = rootCollection
  let fieldSet = rootFieldSet

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const isLast = index === segments.length - 1
    const m2oCollection = m2oRelatedCollection(relations, collection, segment)

    if (isLast) {
      if (!m2oCollection) return null
      return {
        fieldSet,
        m2oField: segment,
        relatedCollection: m2oCollection,
      }
    }

    const related = relatedByKey.get(segment)
    if (related) {
      fieldSet = relatedFieldSets.get(segment) ?? new Set<string>(['id'])
      relatedFieldSets.set(segment, fieldSet)
      collection = related.relatedCollection
      continue
    }

    const o2mChildCollection = findO2MChildCollection(collection, segment, relations)
    if (o2mChildCollection) {
      fieldSet = relatedFieldSets.get(segment) ?? new Set<string>(['id'])
      relatedFieldSets.set(segment, fieldSet)
      collection = o2mChildCollection
      continue
    }

    if (m2oCollection) {
      collection = m2oCollection
      continue
    }

    return null
  }

  return null
}

function expandM2OFieldSet(
  fieldSet: Set<string>,
  m2oField: string,
  templateFields: string[],
  displayField: string,
): void {
  fieldSet.add(m2oField)
  fieldSet.add(`${m2oField}.id`)
  fieldSet.add(`${m2oField}.${displayField}`)
  for (const templateField of templateFields) {
    fieldSet.add(`${m2oField}.${templateField}`)
  }
}

async function enrichFetchPlanWithM2OFields(
  collection: string,
  plan: PayloadFetchPlan,
  payloadPaths: string[],
  relatedRefs: ParentRelatedCollectionRef[],
): Promise<void> {
  const relations = await getCachedRelations()
  const relatedByKey = new Map(
    relatedRefs.map((entry) => [entry.relationKey, entry] as const),
  )
  const rootFieldSet = new Set(plan.rootFields)
  const relatedFieldSets = new Map(
    plan.relatedFetches.map((fetch) => [fetch.relationKey, new Set(fetch.fields)] as const),
  )

  for (const path of payloadPaths) {
    const segments = path.split('.').filter(Boolean)
    const terminal = resolveTerminalM2OContext(
      collection,
      segments,
      relations,
      relatedByKey,
      rootFieldSet,
      relatedFieldSets,
    )
    if (!terminal) continue

    const template = await fetchCollectionDisplayTemplate(terminal.relatedCollection)
    const relatedFields = await getCachedCollectionFields(terminal.relatedCollection)
    const displayField = relatedRecordDisplayField(relatedFields)
    const templateFields = template ? extractTemplateFields(template) : []
    expandM2OFieldSet(
      terminal.fieldSet,
      terminal.m2oField,
      templateFields,
      displayField,
    )
  }

  plan.rootFields = [...rootFieldSet]
  for (const fetch of plan.relatedFetches) {
    const fieldSet = relatedFieldSets.get(fetch.relationKey)
    if (fieldSet) fetch.fields = [...fieldSet]
  }
}

async function renderM2ODisplayLabel(
  relatedCollection: string,
  row: Record<string, unknown>,
): Promise<string> {
  if (isUsersAssetCollection(relatedCollection)) {
    const template = await fetchCollectionDisplayTemplate(relatedCollection)
    const templateFields = template ? extractTemplateFields(template) : []
    if (
      template &&
      shouldUseTemplateForRelatedLabel(template, templateFields)
    ) {
      return renderTemplateLabel(template, row)
    }
    return formatUserLabel(row) || String(row.id ?? '')
  }

  const template = await fetchCollectionDisplayTemplate(relatedCollection)
  const relatedFields = await getCachedCollectionFields(relatedCollection)
  const displayField = relatedRecordDisplayField(relatedFields)
  if (template) {
    return renderTemplateLabel(template, row)
  }
  return String(row[displayField] ?? row.id ?? '')
}

async function resolveM2ODisplayValue(
  relatedCollection: string,
  value: unknown,
  labelCache: Map<string, string>,
): Promise<string | null> {
  if (value == null || value === '') return null

  const template = await fetchCollectionDisplayTemplate(relatedCollection)

  const resolveById = async (id: string | number): Promise<string> => {
    const cacheKey = `${relatedCollection}:${id}`
    const cached = labelCache.get(cacheKey)
    if (cached) return cached

    const option = await fetchRelatedCollectionOptionById(
      relatedCollection,
      id,
      template,
    )
    const label = option?.label ?? String(id)
    labelCache.set(cacheKey, label)
    return label
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>
    let label = await renderM2ODisplayLabel(relatedCollection, row)
    const id = row.id
    if (id != null && (label === '' || label === String(id))) {
      label = await resolveById(id as string | number)
    }
    return label
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return resolveById(value)
  }

  return null
}

async function transformTerminalM2OAtPath(
  payload: Record<string, unknown>,
  segments: string[],
  relatedCollection: string,
  labelCache: Map<string, string>,
): Promise<void> {
  if (segments.length === 0) return

  if (segments.length === 1) {
    const field = segments[0]
    const label = await resolveM2ODisplayValue(
      relatedCollection,
      payload[field],
      labelCache,
    )
    if (label != null) payload[field] = label
    return
  }

  const [head, ...tail] = segments
  const child = payload[head]
  if (Array.isArray(child)) {
    await Promise.all(
      child.map(async (row) => {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          await transformTerminalM2OAtPath(
            row as Record<string, unknown>,
            tail,
            relatedCollection,
            labelCache,
          )
        }
      }),
    )
    return
  }

  if (child && typeof child === 'object' && !Array.isArray(child)) {
    await transformTerminalM2OAtPath(
      child as Record<string, unknown>,
      tail,
      relatedCollection,
      labelCache,
    )
  }
}

async function applyM2ODisplayTemplates(
  collection: string,
  payload: Record<string, unknown>,
  payloadPaths: string[],
): Promise<Record<string, unknown>> {
  const relations = await getCachedRelations()
  const relatedRefs = await listParentRelatedCollections(collection)
  const relatedByKey = new Map(
    relatedRefs.map((entry) => [entry.relationKey, entry] as const),
  )
  const rootFieldSet = new Set<string>()
  const relatedFieldSets = new Map<string, Set<string>>()
  const result = structuredClone(payload) as Record<string, unknown>
  const labelCache = new Map<string, string>()

  for (const path of payloadPaths) {
    const segments = path.split('.').filter(Boolean)
    const terminal = resolveTerminalM2OContext(
      collection,
      segments,
      relations,
      relatedByKey,
      rootFieldSet,
      relatedFieldSets,
    )
    if (!terminal) continue

    await transformTerminalM2OAtPath(
      result,
      segments,
      terminal.relatedCollection,
      labelCache,
    )
  }

  return result
}

function buildPayloadFetchPlan(
  collection: string,
  payloadPaths: string[],
  relatedRefs: ParentRelatedCollectionRef[],
): PayloadFetchPlan {
  const relatedByKey = new Map(
    relatedRefs.map((entry) => [entry.relationKey, entry] as const),
  )
  const rootFieldSet = new Set<string>(['id'])
  const relatedFieldSets = new Map<string, Set<string>>()

  for (const path of payloadPaths) {
    const segments = path.split('.').filter(Boolean)
    if (segments.length === 0) continue

    const rootKey = segments[0]
    const related = relatedByKey.get(rootKey)

    if (related) {
      const fieldSet = relatedFieldSets.get(rootKey) ?? new Set<string>(['id'])
      if (segments.length > 1) {
        addNestedFieldPaths(fieldSet, segments.slice(1))
      }
      relatedFieldSets.set(rootKey, fieldSet)
      continue
    }

    addNestedFieldPaths(rootFieldSet, segments)
  }

  const relatedFetches: PayloadFetchPlan['relatedFetches'] = []

  for (const [relationKey, fieldSet] of relatedFieldSets) {
    const related = relatedByKey.get(relationKey)
    if (!related) continue

    const parentFkField = resolveParentFkField(related.relation, collection)
    if (!parentFkField) continue

    relatedFetches.push({
      relationKey,
      relatedCollection: related.relatedCollection,
      parentFkField,
      fields: [...fieldSet],
    })
  }

  return {
    rootFields: [...rootFieldSet],
    relatedFetches,
  }
}

/** Fetches a nested record payload driven by paths referenced in the field mapping result. */
export async function fetchDocMappingPayload(
  collection: string,
  id: string,
  mapping: Record<string, unknown>,
  options?: { payloadPaths?: string[] },
): Promise<Record<string, unknown>> {
  const payloadPaths = options?.payloadPaths ?? extractPayloadPaths(mapping)
  const relatedRefs = await listParentRelatedCollections(collection)

  if (payloadPaths.length === 0) {
    return bridgeReadItem(collection, id, { fields: ['id'] })
  }

  const plan = buildPayloadFetchPlan(collection, payloadPaths, relatedRefs)
  await enrichFetchPlanWithM2OFields(collection, plan, payloadPaths, relatedRefs)

  const record = await bridgeReadItem(collection, id, {
    fields: plan.rootFields,
  })

  await Promise.all(
    plan.relatedFetches.map(async (fetch) => {
      try {
        const rows = await bridgeReadItems(fetch.relatedCollection, {
          filter: { [fetch.parentFkField]: { _eq: id } },
          fields: fetch.fields,
          limit: -1,
        })
        record[fetch.relationKey] = rows
      } catch {
        record[fetch.relationKey] = []
      }
    }),
  )

  return record
}

/**
 * Paths under `$payload.records.*` used for per-row CRM fetches.
 * Root `$payload.field` mappings (common when list sample was off) are treated as row fields.
 */
export function deriveListRowPayloadPaths(payloadPaths: string[]): string[] {
  const fieldPaths = payloadPaths
    .filter((path) => path.startsWith('records.'))
    .map((path) => path.slice('records.'.length))
    .filter(Boolean)

  // Bare `$payload.records` alone is only a table source marker — always keep `id`,
  // and prefer concrete `records.*` fields when the mapping has relative `items`.
  if (fieldPaths.length > 0) {
    return [...new Set(['id', ...fieldPaths])]
  }

  if (payloadPaths.some((path) => path === 'records')) {
    return ['id']
  }

  // Mapping without records.* prefix — treat non-meta / non-parent paths as row fields.
  return [
    ...new Set(
      payloadPaths.filter(
        (path) =>
          path !== 'meta' &&
          !path.startsWith('meta.') &&
          path !== 'parent' &&
          !path.startsWith('parent.'),
      ),
    ),
  ]
}

/**
 * Rewrite `$payload.field` → `$payload.records.field` so DocEngine table expansion
 * uses `records[]` as the source array (sourceArrayPath = `$payload.records`).
 * Leaves `$payload.records.*` and `$payload.meta.*` unchanged.
 */
export function rewriteMappingPathsForListRecords(
  mapping: Record<string, unknown>,
): Record<string, unknown> {
  return rewriteMappingPathValue(mapping) as Record<string, unknown>
}

function rewriteListPayloadSourcePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('$payload')) return value

  // Keep `#format` / `|format` on the path while rewriting the payload prefix.
  const suffixMatch = trimmed.match(/^(.*?)([#|][^#|]+)$/)
  const base = suffixMatch ? suffixMatch[1] : trimmed
  const formatSuffix = suffixMatch ? suffixMatch[2] : ''

  let rewritten = base
  if (
    base === '$payload.records' ||
    base.startsWith('$payload.records.') ||
    base === '$payload.meta' ||
    base.startsWith('$payload.meta.') ||
    base === '$payload.parent' ||
    base.startsWith('$payload.parent.')
  ) {
    rewritten = base
  } else if (base === '$payload') {
    rewritten = '$payload.records'
  } else if (base.startsWith('$payload.')) {
    rewritten = `$payload.records.${base.slice('$payload.'.length)}`
  } else {
    return value
  }

  return formatSuffix ? `${rewritten}${formatSuffix}` : rewritten
}

function rewriteMappingPathValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return rewriteListPayloadSourcePath(value)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteMappingPathValue(entry))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = rewriteMappingPathValue(nested)
    }
    return out
  }
  return value
}

/** `$payload.meta.filter`: `{ "Date Visit Start": value, ... }`. */
export type DocListFilterMetaBlock = Record<string, unknown>

export interface DocListMappingMeta {
  collection: string
  count: number
  generatedAt: string
  /** Current list filter labels → values (including interactive overrides). */
  filter?: DocListFilterMetaBlock | null
  /** Parent record when the list is a related/child collection report. */
  parent?: Record<string, unknown> | null
  viewLabel?: string | null
}

/** Builds `{ records, meta }` for Option B list DocEngine reports. */
export async function fetchDocListMappingPayload(
  collection: string,
  recordIds: string[],
  mapping: Record<string, unknown>,
  meta?: Partial<Omit<DocListMappingMeta, 'collection' | 'count' | 'generatedAt'>>,
): Promise<{ records: Record<string, unknown>[]; meta: DocListMappingMeta }> {
  const rowPaths = deriveListRowPayloadPaths(extractPayloadPaths(mapping))
  const records = await Promise.all(
    recordIds.map((id) =>
      fetchDocMappingPayload(collection, id, mapping, { payloadPaths: rowPaths }),
    ),
  )

  return {
    records,
    meta: {
      collection,
      count: records.length,
      generatedAt: new Date().toISOString(),
      filter: meta?.filter ?? null,
      parent: meta?.parent ?? null,
      viewLabel: meta?.viewLabel ?? null,
    },
  }
}

/**
 * Applies field mapping for a list payload. Resolves M2O labels per row using
 * stripped `records.*` paths, then runs DocEngine applyFieldMapping on the wrap.
 * Root `$payload.*` mappings are rewritten to `$payload.records.*` automatically.
 */
export async function applyDocListFieldMapping(
  collection: string,
  mapping: Record<string, unknown>,
  listPayload: {
    records: Record<string, unknown>[]
    meta?: DocListMappingMeta | Record<string, unknown>
  },
  template: DocTemplateShape,
) {
  const normalizedMapping = normalizeMappingFormatSuffixes(mapping)
  const listMapping = rewriteMappingPathsForListRecords(normalizedMapping)
  const payloadPaths = extractPayloadPaths(listMapping)
  const rowPaths = deriveListRowPayloadPaths(payloadPaths)
  const resolvedRows = await Promise.all(
    listPayload.records.map((row) => applyM2ODisplayTemplates(collection, row, rowPaths)),
  )
  const { mapping: formattedMapping, records: formattedRows } =
    applyTableItemDateFormatsToRecords(listMapping, resolvedRows)
  const resolvedPayload: Record<string, unknown> = {
    ...listPayload,
    records: formattedRows,
  }
  const spec = mappingSpecFromStored(formattedMapping, template)
  return applyFieldMapping(resolvedPayload, spec, template as never)
}

export function serializeFieldMappingForSave(
  spec: FieldMappingSpec | null,
): Record<string, unknown> | null {
  if (!spec?.rules?.length) return null
  return buildMappingResultFromRules(spec.rules) as unknown as Record<string, unknown>
}

function templateShapeFromBody(body: Record<string, unknown>): DocTemplateShape {
  if (body.kind === 'document') {
    return buildTemplateExport(body as never) as DocTemplateShape
  }
  return {
    blocks: (body.blocks as unknown[]) ?? [],
    fieldSchemas: (body.fieldSchemas as Record<string, unknown>) ?? {},
  }
}

function mappingSpecFromStored(
  mapping: Record<string, unknown>,
  template: DocTemplateShape,
): FieldMappingSpec {
  if (isDocFieldMappingResult(mapping)) {
    const rules = parseMappingResultToRules(
      mapping,
      (template.blocks ?? []) as never,
      (template.fieldSchemas ?? {}) as never,
    )
    return normalizeFieldMappingSpec({
      rules,
      expression: '',
    } as FieldMappingSpec)
  }

  if (isFieldMappingSpec(mapping)) {
    return normalizeFieldMappingSpec(mapping)
  }

  throw new Error('Invalid field mapping configuration.')
}

export async function applyDocFieldMapping(
  collection: string,
  mapping: Record<string, unknown>,
  payload: Record<string, unknown>,
  template: DocTemplateShape,
) {
  const normalizedMapping = normalizeMappingFormatSuffixes(mapping)
  const spec = mappingSpecFromStored(normalizedMapping, template)
  const payloadPaths = extractPayloadPaths(normalizedMapping)
  const resolvedPayload = await applyM2ODisplayTemplates(collection, payload, payloadPaths)
  return applyFieldMapping(resolvedPayload, spec, template as never)
}

/** Restores in-editor mapping state from a stored mapping result (or legacy spec). */
export async function fieldMappingToEditorSpec(
  mapping: Record<string, unknown>,
  collection: string,
  body: Record<string, unknown>,
): Promise<FieldMappingSpec | null> {
  const template = templateShapeFromBody(body)

  if (isDocFieldMappingResult(mapping)) {
    const rules = parseMappingResultToRules(
      mapping,
      (template.blocks ?? []) as never,
      (template.fieldSchemas ?? {}) as never,
    )
    const sourceSample = await buildDocSourceSamplePayload(collection)
    return normalizeFieldMappingSpec({
      rules,
      sourceSample,
      expression: '',
    } as FieldMappingSpec)
  }

  if (isFieldMappingSpec(mapping)) {
    const legacy = normalizeFieldMappingSpec(mapping)
    const sourceSample =
      legacy.sourceSample ?? (await buildDocSourceSamplePayload(collection))
    return normalizeFieldMappingSpec({
      ...legacy,
      sourceSample,
    })
  }

  return null
}

/** Builds a design-time sample payload containing only fields referenced by the mapping. */
export async function buildDocMappingSamplePayload(
  collection: string,
  mapping: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fullSample = await buildDocSourceSamplePayload(collection)
  const payloadPaths = extractPayloadPaths(mapping)
  if (payloadPaths.length === 0) return fullSample

  const relatedRefs = await listParentRelatedCollections(collection)
  const plan = buildPayloadFetchPlan(collection, payloadPaths, relatedRefs)
  const sample: Record<string, unknown> = { id: fullSample.id ?? 1 }

  for (const field of plan.rootFields) {
    if (field === 'id') continue
    const value = pickSamplePath(fullSample, field)
    if (value !== undefined) setSamplePath(sample, field, value)
  }

  for (const fetch of plan.relatedFetches) {
    const arraySample = fullSample[fetch.relationKey]
    if (Array.isArray(arraySample) && arraySample.length > 0) {
      sample[fetch.relationKey] = arraySample.map((row) =>
        pickSampleRow(row as Record<string, unknown>, fetch.fields),
      )
    } else {
      sample[fetch.relationKey] = []
    }
  }

  return sample
}

function pickSamplePath(source: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.').filter(Boolean)
  let current: unknown = source
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function setSamplePath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0) return

  let current: Record<string, unknown> = target
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const existing = current[segment]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
}

function pickSampleRow(
  row: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const sample: Record<string, unknown> = {}
  if (row.id !== undefined) sample.id = row.id

  for (const field of fields) {
    if (field === 'id') continue
    const value = pickSamplePath(row, field)
    if (value !== undefined) setSamplePath(sample, field, value)
  }

  return sample
}
