import {
  applyFieldMapping,
  buildMappingResultFromRules,
  buildTemplateExport,
  getTableMappingSourcePath,
  isFieldMappingSpec,
  isTableMappingObject,
  normalizeFieldMappingSpec,
  parseMappingResultToRules,
  toAbsoluteColumnPath,
} from '@docengine/editor'

/** Normalized field-mapping config from `@docengine/editor` (type is no longer exported). */
export type FieldMappingSpec = ReturnType<typeof normalizeFieldMappingSpec>
import { formatDateValue } from '@/core/dateFormatting'
import { relatedCollectionForCollectionField } from '@/core/relationHelpers'
import { bridgeReadItem, bridgeReadItems } from '@/core/graphql/itemsBridge'
import { keysEqual } from '@/core/utils/object'
import { isUsersAssetCollection } from '@/core/usersField'
import type { DataTableSortConfig, RelationDefinition } from '@/interfaces'
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
  ITEM_GROUP_TREE_ITEM_SORT_KEY,
  ITEM_GROUP_TREE_KEY,
  ITEM_GROUP_TREE_ROWS_KEY,
  ITEM_GROUP_TREE_SECTIONS_KEY,
  loadItemGroupPriceTree,
  loadItemGroupPriceTreeViaBridge,
  mappingNeedsItemGroupPriceTree,
  resolveItemGroupPriceTreeOptionsFromContext,
  resolveTreeScopeRecordId,
  stripItemGroupPriceTreePayloadPaths,
  type LoadItemGroupPriceTreeOptions,
} from '@/core/itemGroupPriceTree'
import {
  extractTemplateFields,
  formatNumberDisplayValue,
  formatUserLabel,
  getPathValue,
  relatedRecordDisplayField,
  renderTemplateLabel,
  resolveNumberDisplayOptions,
  shouldUseTemplateForRelatedLabel,
  type NumberDisplayOptions,
} from '@/modules/entities/utils/recordDisplay'

export {
  buildDocSourceSamplePayload,
  collectionSupportsItemGroupPriceTreeSample,
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
      const table = value as { items: Record<string, unknown> }
      const nextItems: Record<string, unknown> = {}
      for (const [columnKey, columnValue] of Object.entries(table.items)) {
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

/** Resolve `$children` (etc.) against a parent `$payload…` array path. */
function absolutizeMappingSource(
  source: string,
  parentPayloadSource?: string,
): string {
  const trimmed = source.trim()
  if (trimmed.startsWith('$payload')) return trimmed
  if (parentPayloadSource?.startsWith('$payload') && trimmed.startsWith('$')) {
    return `${parentPayloadSource}.${trimmed.replace(/^\$/, '')}`
  }
  return trimmed
}

/**
 * True DocEngine table: `{ _source, items: { col: "$path" } }`.
 * Distinguishes sourced sections whose field is literally named `items`.
 */
function isDocTableMapping(value: unknown): boolean {
  if (!isTableMappingObject(value)) return false
  const items = (value as { items: Record<string, unknown> }).items
  return !getTableMappingSourcePath(items)
}

/**
 * Section field map with `_source` plus sibling fields (optional nested table
 * field named `items`).
 */
function isSourcedSectionFieldMap(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = getTableMappingSourcePath(value)
  if (!source) return false
  if (!isTableMappingObject(value)) return true
  return !isDocTableMapping(value)
}

/**
 * Nested price table stored as `{ _source: "$children", Item: "$item", … }`
 * without an `items` wrapper (designer sometimes emits this shape).
 */
function isFlatSourcedColumnMap(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (isDocTableMapping(value) || isTableMappingObject(value)) return false
  const source = getTableMappingSourcePath(value)
  if (!source) return false
  return Object.keys(value as object).some(
    (key) => key !== '_source' && key !== 'source',
  )
}

function collectPayloadPathStrings(
  value: unknown,
  paths: Set<string>,
  parentPayloadSource?: string,
): void {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('$payload')) {
      paths.add(trimmed)
      return
    }
    // Relative `$item` / `$price` under a nested `$children` table → absolute payload path.
    if (parentPayloadSource?.startsWith('$payload') && trimmed.startsWith('$')) {
      const absolute = toAbsoluteColumnPath(parentPayloadSource, trimmed).trim()
      if (absolute.startsWith('$payload')) paths.add(absolute)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectPayloadPathStrings(item, paths, parentPayloadSource)
    return
  }

  if (value && typeof value === 'object') {
    // DocEngine table schema: { _source: "$payload.…", items: { col: "$rel" } }
    if (isDocTableMapping(value)) {
      const source = getTableMappingSourcePath(value)
      const items = (value as { items: Record<string, unknown> }).items
      const absoluteSource = absolutizeMappingSource(source, parentPayloadSource)
      if (absoluteSource.startsWith('$payload')) paths.add(absoluteSource)

      const joinSource = absoluteSource.startsWith('$payload')
        ? absoluteSource
        : source
      for (const columnValue of Object.values(items)) {
        if (typeof columnValue === 'string') {
          const absolute = toAbsoluteColumnPath(joinSource, columnValue).trim()
          if (absolute.startsWith('$payload')) paths.add(absolute)
          continue
        }
        collectPayloadPathStrings(
          columnValue,
          paths,
          absoluteSource.startsWith('$payload') ? absoluteSource : parentPayloadSource,
        )
      }
      return
    }

    // Sourced section: `_source` + sibling fields (including nested tables).
    if (isSourcedSectionFieldMap(value) || isFlatSourcedColumnMap(value)) {
      const source = getTableMappingSourcePath(value)
      const absoluteSource = absolutizeMappingSource(source, parentPayloadSource)
      if (absoluteSource.startsWith('$payload')) paths.add(absoluteSource)
      const childParent = absoluteSource.startsWith('$payload')
        ? absoluteSource
        : parentPayloadSource
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (key === '_source' || key === 'source') continue
        collectPayloadPathStrings(nested, paths, childParent)
      }
      return
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectPayloadPathStrings(nested, paths, parentPayloadSource)
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

/** Virtual collection for nested `item_group_tree` nodes (not a CRM entity). */
const ITEM_GROUP_TREE_NODE_VIRTUAL = '__item_group_tree_node__'
/** Group shells from `item_group_tree_rows` / `sections` (prices nested under children/item_prices). */
const ITEM_GROUP_TREE_SHELL_VIRTUAL = '__item_group_tree_shell__'
const ITEM_PRICE_COLLECTION = 'item_price'

/**
 * Map synthetic doc payload keys onto virtual / CRM collections so M2O labeling
 * and number formatting can walk `item_group_tree_rows.children.item`, etc.
 */
function resolveSyntheticCollection(
  currentCollection: string,
  segment: string,
): string | null {
  if (keysEqual(segment, ITEM_GROUP_TREE_ROWS_KEY)) return ITEM_GROUP_TREE_SHELL_VIRTUAL
  if (keysEqual(segment, ITEM_GROUP_TREE_SECTIONS_KEY)) {
    return ITEM_GROUP_TREE_SHELL_VIRTUAL
  }
  if (keysEqual(segment, ITEM_GROUP_TREE_KEY)) return ITEM_GROUP_TREE_NODE_VIRTUAL

  if (currentCollection === ITEM_GROUP_TREE_NODE_VIRTUAL) {
    if (keysEqual(segment, 'item_prices')) return ITEM_PRICE_COLLECTION
    if (keysEqual(segment, 'children')) return ITEM_GROUP_TREE_NODE_VIRTUAL
  }
  if (currentCollection === ITEM_GROUP_TREE_SHELL_VIRTUAL) {
    if (keysEqual(segment, 'item_prices') || keysEqual(segment, 'children')) {
      return ITEM_PRICE_COLLECTION
    }
  }
  return null
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

    const synthetic = resolveSyntheticCollection(collection, segment)
    if (synthetic) {
      fieldSet = relatedFieldSets.get(segment) ?? new Set<string>(['id'])
      relatedFieldSets.set(segment, fieldSet)
      collection = synthetic
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
    const id = row.id
    const templateFields = template ? extractTemplateFields(template) : []
    // Nested payload objects often only include `id`/`name`; refetch when any
    // Display Template token is missing so `$item` is not a bare code.
    const missingTemplateField =
      templateFields.length > 0 &&
      templateFields.some((field) => {
        const tokenValue = getPathValue(row, field)
        return tokenValue == null || tokenValue === ''
      })
    if (missingTemplateField && id != null && id !== '') {
      return resolveById(id as string | number)
    }

    let label = await renderM2ODisplayLabel(relatedCollection, row)
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

/**
 * When a parent M2O must stay an object (nested column paths like `$item.group`),
 * stash the Display Template label here so `$item` can be rewritten to this key.
 */
const HELIX_M2O_DISPLAY_LABEL = '__helixDisplayLabel'

function pathHasNestedDependent(path: string, allPaths: string[]): boolean {
  const prefix = `${path}.`
  return allPaths.some((candidate) => candidate.startsWith(prefix))
}

/**
 * Walk `item_group_tree` nodes depth-first so nested `item_prices` get M2O labels.
 */
async function transformItemGroupTreeNodesM2O(
  nodes: Array<Record<string, unknown>>,
  remainingSegments: string[],
  relatedCollection: string,
  labelCache: Map<string, string>,
  mode: 'replace' | 'attachLabel',
): Promise<void> {
  await Promise.all(
    nodes.map(async (node) => {
      await transformTerminalM2OAtPath(
        node,
        remainingSegments,
        relatedCollection,
        labelCache,
        mode,
      )
      const children = node.children
      if (Array.isArray(children) && children.length > 0) {
        const childNodes = children.filter(
          (row): row is Record<string, unknown> =>
            Boolean(row) && typeof row === 'object' && !Array.isArray(row),
        )
        if (childNodes.length > 0) {
          await transformItemGroupTreeNodesM2O(
            childNodes,
            remainingSegments,
            relatedCollection,
            labelCache,
            mode,
          )
        }
      }
    }),
  )
}

async function transformTerminalM2OAtPath(
  payload: Record<string, unknown>,
  segments: string[],
  relatedCollection: string,
  labelCache: Map<string, string>,
  mode: 'replace' | 'attachLabel' = 'replace',
): Promise<void> {
  if (segments.length === 0) return

  if (segments.length === 1) {
    const field = segments[0]
    const current = payload[field]
    const label = await resolveM2ODisplayValue(
      relatedCollection,
      current,
      labelCache,
    )
    if (label == null) return

    if (mode === 'attachLabel') {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        ;(current as Record<string, unknown>)[HELIX_M2O_DISPLAY_LABEL] = label
      } else if (current != null && current !== '') {
        // Scalar FK — keep id access via nested paths unavailable; still expose label.
        payload[field] = { id: current, [HELIX_M2O_DISPLAY_LABEL]: label }
      }
      return
    }

    payload[field] = label
    return
  }

  const [head, ...tail] = segments
  const child = payload[head]

  // Nested group tree: apply remaining path on each node and every descendant.
  if (keysEqual(head, ITEM_GROUP_TREE_KEY) && Array.isArray(child)) {
    const nodes = child.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === 'object' && !Array.isArray(row),
    )
    await transformItemGroupTreeNodesM2O(
      nodes,
      tail,
      relatedCollection,
      labelCache,
      mode,
    )
    return
  }

  if (Array.isArray(child)) {
    await Promise.all(
      child.map(async (row) => {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          await transformTerminalM2OAtPath(
            row as Record<string, unknown>,
            tail,
            relatedCollection,
            labelCache,
            mode,
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
      mode,
    )
  }
}

/**
 * Rewrite whole-M2O column paths (`$item`) to `$item.__helixDisplayLabel` when
 * nested paths under that M2O are also mapped (object kept; label on the related row).
 */
function rewriteWholeM2OColumnPathsForNesting(
  mapping: Record<string, unknown>,
  preservedObjectPaths: Set<string>,
): Record<string, unknown> {
  if (preservedObjectPaths.size === 0) return mapping

  const rewriteColumnString = (columnValue: string, source: string): string => {
    const { path, format } = splitMappingPathAndFormat(columnValue)
    const absolute = toAbsoluteColumnPath(source, path)
      .trim()
      .replace(/^\$payload\.?/, '')
    if (!preservedObjectPaths.has(absolute)) return columnValue
    const suffix = format ? `#${format}` : ''
    if (path.startsWith('$payload')) {
      return `${path}.${HELIX_M2O_DISPLAY_LABEL}${suffix}`
    }
    // `$item` → `$item.__helixDisplayLabel` (DocEngine reads related.item label).
    if (path === '$item' || path === 'item') {
      return `$item.${HELIX_M2O_DISPLAY_LABEL}${suffix}`
    }
    const base = path.startsWith('$') ? path : `$${path}`
    return `${base}.${HELIX_M2O_DISPLAY_LABEL}${suffix}`
  }

  const visitColumnMap = (
    items: Record<string, unknown>,
    source: string,
  ): Record<string, unknown> => {
    const nextItems: Record<string, unknown> = {}
    for (const [columnKey, columnValue] of Object.entries(items)) {
      if (typeof columnValue === 'string') {
        nextItems[columnKey] = rewriteColumnString(columnValue, source)
        continue
      }
      if (
        columnValue &&
        typeof columnValue === 'object' &&
        !Array.isArray(columnValue) &&
        !isTableMappingObject(columnValue)
      ) {
        nextItems[columnKey] = visitColumnMap(
          columnValue as Record<string, unknown>,
          source,
        )
        continue
      }
      nextItems[columnKey] = visit(columnValue)
    }
    return nextItems
  }

  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map((entry) => visit(entry))
    if (!value || typeof value !== 'object') return value

    if (isSourcedSectionFieldMap(value)) {
      const source = getTableMappingSourcePath(value)
      const section = value as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [key, nested] of Object.entries(section)) {
        if (key === '_source' || key === 'source') {
          out[key] = nested
          continue
        }
        if (typeof nested === 'string') {
          out[key] = rewriteColumnString(nested, source)
          continue
        }
        out[key] = visit(nested)
      }
      return out
    }

    if (isDocTableMapping(value)) {
      const source = getTableMappingSourcePath(value)
      const table = value as { items: Record<string, unknown> }
      return { ...value, items: visitColumnMap(table.items, source) }
    }

    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = visit(nested)
    }
    return out
  }

  return visit(mapping) as Record<string, unknown>
}

async function applyM2ODisplayTemplates(
  collection: string,
  payload: Record<string, unknown>,
  payloadPaths: string[],
): Promise<{ payload: Record<string, unknown>; preservedObjectPaths: Set<string> }> {
  const relations = await getCachedRelations()
  const relatedRefs = await listParentRelatedCollections(collection)
  const relatedByKey = new Map(
    relatedRefs.map((entry) => [entry.relationKey, entry] as const),
  )
  const rootFieldSet = new Set<string>()
  const relatedFieldSets = new Map<string, Set<string>>()
  const result = structuredClone(payload) as Record<string, unknown>
  const labelCache = new Map<string, string>()
  const preservedObjectPaths = new Set<string>()

  // Deepest paths first so nested M2O labels are applied before parent handling.
  const sortedPaths = [...payloadPaths].sort(
    (a, b) => b.split('.').length - a.split('.').length,
  )

  for (const path of sortedPaths) {
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

    if (pathHasNestedDependent(path, payloadPaths)) {
      // Keep the object so `$item.group` can resolve; attach label for `$item`.
      preservedObjectPaths.add(path)
      await transformTerminalM2OAtPath(
        result,
        segments,
        terminal.relatedCollection,
        labelCache,
        'attachLabel',
      )
      continue
    }

    await transformTerminalM2OAtPath(
      result,
      segments,
      terminal.relatedCollection,
      labelCache,
      'replace',
    )
  }

  return { payload: result, preservedObjectPaths }
}

/**
 * Walk relation / O2M segments to the collection that owns the terminal field.
 * Returns null when the path cannot be resolved against schema relations.
 */
function resolveCollectionForFieldPath(
  rootCollection: string,
  parentSegments: string[],
  relations: RelationDefinition[],
  relatedByKey: Map<string, ParentRelatedCollectionRef>,
): string | null {
  let collection = rootCollection

  for (const segment of parentSegments) {
    const related = relatedByKey.get(segment)
    if (related) {
      collection = related.relatedCollection
      continue
    }

    const o2mChildCollection = findO2MChildCollection(collection, segment, relations)
    if (o2mChildCollection) {
      collection = o2mChildCollection
      continue
    }

    const synthetic = resolveSyntheticCollection(collection, segment)
    if (synthetic) {
      collection = synthetic
      continue
    }

    const m2oCollection = m2oRelatedCollection(relations, collection, segment)
    if (m2oCollection) {
      collection = m2oCollection
      continue
    }

    return null
  }

  return collection
}

function transformNumberDisplayAtPath(
  payload: Record<string, unknown>,
  segments: string[],
  options: NumberDisplayOptions,
): void {
  if (segments.length === 0) return

  if (segments.length === 1) {
    const field = segments[0]
    const formatted = formatNumberDisplayValue(payload[field], options)
    if (formatted != null) payload[field] = formatted
    return
  }

  const [head, ...tail] = segments
  const child = payload[head]
  if (Array.isArray(child)) {
    for (const row of child) {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        transformNumberDisplayAtPath(row as Record<string, unknown>, tail, options)
      }
    }
    return
  }

  if (child && typeof child === 'object' && !Array.isArray(child)) {
    transformNumberDisplayAtPath(child as Record<string, unknown>, tail, options)
  }
}

/**
 * Format Currency / Number CRM fields in the mapping payload (e.g. always 2
 * fraction digits) so DocEngine table cells match list/detail display.
 */
async function applyNumberDisplayFormats(
  collection: string,
  payload: Record<string, unknown>,
  payloadPaths: string[],
): Promise<Record<string, unknown>> {
  const relations = await getCachedRelations()
  const relatedRefs = await listParentRelatedCollections(collection)
  const relatedByKey = new Map(
    relatedRefs.map((entry) => [entry.relationKey, entry] as const),
  )
  const result = structuredClone(payload) as Record<string, unknown>
  const optionsCache = new Map<string, NumberDisplayOptions | null>()

  for (const path of payloadPaths) {
    const segments = path.split('.').filter(Boolean)
    if (segments.length === 0) continue

    const fieldName = segments[segments.length - 1]
    const parentSegments = segments.slice(0, -1)
    const ownerCollection = resolveCollectionForFieldPath(
      collection,
      parentSegments,
      relations,
      relatedByKey,
    )
    if (!ownerCollection) continue

    // Skip paths that end on an M2O relation key (labels handled separately).
    if (m2oRelatedCollection(relations, ownerCollection, fieldName)) continue

    const cacheKey = `${ownerCollection}:${fieldName}`
    let displayOptions = optionsCache.get(cacheKey)
    if (displayOptions === undefined) {
      const fields = await getCachedCollectionFields(ownerCollection)
      const definition = fields.find((field) => field.field === fieldName) ?? null
      displayOptions = resolveNumberDisplayOptions(definition)
      optionsCache.set(cacheKey, displayOptions)
    }
    if (!displayOptions) continue

    transformNumberDisplayAtPath(result, segments, displayOptions)
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

async function resolveDocTreeLoadOptions(
  collection: string,
  recordId: string,
  record: Record<string, unknown>,
): Promise<LoadItemGroupPriceTreeOptions> {
  const base = await resolveItemGroupPriceTreeOptionsFromContext(collection)
  const priceGroupId = resolveTreeScopeRecordId(
    recordId,
    record,
    base.priceGroupField ?? '',
  )
  return { ...base, priceGroupId }
}

async function attachItemGroupPriceTreeToPayload(
  collection: string,
  recordId: string,
  record: Record<string, unknown>,
  payloadPaths: string[],
): Promise<void> {
  if (!mappingNeedsItemGroupPriceTree(payloadPaths)) return
  try {
    const options = await resolveDocTreeLoadOptions(collection, recordId, record)
    const result = await loadItemGroupPriceTree(options)
    record[ITEM_GROUP_TREE_KEY] = result.tree
    record[ITEM_GROUP_TREE_ROWS_KEY] = result.rows
    record[ITEM_GROUP_TREE_SECTIONS_KEY] = result.sections
    record[ITEM_GROUP_TREE_ITEM_SORT_KEY] = options.itemSort ?? null
  } catch (error) {
    console.warn('[documents] item_group_tree load failed', error)
    record[ITEM_GROUP_TREE_KEY] = []
    record[ITEM_GROUP_TREE_ROWS_KEY] = []
    record[ITEM_GROUP_TREE_SECTIONS_KEY] = []
    record[ITEM_GROUP_TREE_ITEM_SORT_KEY] = null
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
  const crmPaths = stripItemGroupPriceTreePayloadPaths(payloadPaths)
  const relatedRefs = await listParentRelatedCollections(collection)

  let treeScopeField = ''
  if (mappingNeedsItemGroupPriceTree(payloadPaths)) {
    try {
      const treeOpts = await resolveItemGroupPriceTreeOptionsFromContext(collection)
      treeScopeField = treeOpts.priceGroupField?.trim() || ''
    } catch {
      treeScopeField = ''
    }
  }

  if (crmPaths.length === 0) {
    const fields = ['id']
    if (treeScopeField && !keysEqual(treeScopeField, 'id')) {
      fields.push(treeScopeField)
    }
    const record =
      payloadPaths.length === 0
        ? await bridgeReadItem(collection, id, { fields: ['id'] })
        : await bridgeReadItem(collection, id, { fields })
    await attachItemGroupPriceTreeToPayload(collection, id, record, payloadPaths)
    return record
  }

  const plan = buildPayloadFetchPlan(collection, crmPaths, relatedRefs)
  await enrichFetchPlanWithM2OFields(collection, plan, crmPaths, relatedRefs)

  if (
    treeScopeField &&
    !plan.rootFields.some(
      (field) => field === treeScopeField || field.startsWith(`${treeScopeField}.`),
    )
  ) {
    plan.rootFields.push(treeScopeField)
  }

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

  await attachItemGroupPriceTreeToPayload(collection, id, record, payloadPaths)
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
      stripItemGroupPriceTreePayloadPaths(
        payloadPaths.filter(
          (path) =>
            path !== 'meta' &&
            !path.startsWith('meta.') &&
            path !== 'parent' &&
            !path.startsWith('parent.'),
        ),
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
    base.startsWith('$payload.parent.') ||
    base === `$payload.${ITEM_GROUP_TREE_KEY}` ||
    base.startsWith(`$payload.${ITEM_GROUP_TREE_KEY}.`) ||
    base === `$payload.${ITEM_GROUP_TREE_ROWS_KEY}` ||
    base.startsWith(`$payload.${ITEM_GROUP_TREE_ROWS_KEY}.`) ||
    base === `$payload.${ITEM_GROUP_TREE_SECTIONS_KEY}` ||
    base.startsWith(`$payload.${ITEM_GROUP_TREE_SECTIONS_KEY}.`)
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
): Promise<{
  records: Record<string, unknown>[]
  meta: DocListMappingMeta
  item_group_tree?: unknown
  item_group_tree_rows?: unknown
}> {
  const allPaths = extractPayloadPaths(mapping)
  const rowPaths = deriveListRowPayloadPaths(allPaths)
  const records = await Promise.all(
    recordIds.map((id) =>
      fetchDocMappingPayload(collection, id, mapping, { payloadPaths: rowPaths }),
    ),
  )

  const payload: {
    records: Record<string, unknown>[]
    meta: DocListMappingMeta
    item_group_tree?: unknown
    item_group_tree_rows?: unknown
    item_group_tree_sections?: unknown
  } = {
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

  if (mappingNeedsItemGroupPriceTree(allPaths)) {
    try {
      const base = await resolveItemGroupPriceTreeOptionsFromContext(collection)
      const sample = records[0] ?? {}
      const listCollectionTree = !base.priceGroupField?.trim()
      // List Tree mode: build the tree only from the report's filtered rows.
      // Parent-doc mode (e.g. price_group): scope by the parent M2O as before.
      const options: LoadItemGroupPriceTreeOptions = listCollectionTree
        ? {
            ...base,
            priceGroupId: null,
            filter: recordIds.length ? { id: { _in: recordIds } } : null,
          }
        : {
            ...base,
            priceGroupId: resolveTreeScopeRecordId(
              recordIds[0] ?? '',
              sample,
              base.priceGroupField ?? '',
            ),
          }
      // List-collection Tree / Table reports: bridge + id filter so every list row is included.
      // Parent-doc trees keep the BFF path scoped by priceGroupId.
      const treeResult = listCollectionTree
        ? await loadItemGroupPriceTreeViaBridge(options)
        : await loadItemGroupPriceTree(options)
      payload[ITEM_GROUP_TREE_KEY] = treeResult.tree
      payload[ITEM_GROUP_TREE_ROWS_KEY] = treeResult.rows
      payload[ITEM_GROUP_TREE_SECTIONS_KEY] = treeResult.sections
      payload[ITEM_GROUP_TREE_ITEM_SORT_KEY] = options.itemSort ?? null
    } catch (error) {
      console.warn('[documents] item_group_tree load failed', error)
      payload[ITEM_GROUP_TREE_KEY] = []
      payload[ITEM_GROUP_TREE_ROWS_KEY] = []
      payload[ITEM_GROUP_TREE_SECTIONS_KEY] = []
      payload[ITEM_GROUP_TREE_ITEM_SORT_KEY] = null
    }
  }

  return payload
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
    /** Designer: `$payload.item_group_tree` */
    item_group_tree?: unknown
    /** Designer: `$payload.item_group_tree_rows` + nested `$children` */
    item_group_tree_rows?: unknown
    /** Designer: `$payload.item_group_tree_sections` + nested `$item_prices` */
    item_group_tree_sections?: unknown
  },
  template: DocTemplateShape,
) {
  const normalizedMapping = rewriteItemGroupTreeRowsGroupColumns(
    rewriteItemGroupTreeNestedSources(normalizeMappingFormatSuffixes(mapping)),
  )
  const listMapping = rewriteMappingPathsForListRecords(normalizedMapping)
  const payloadPaths = extractPayloadPaths(listMapping)
  const rowPaths = deriveListRowPayloadPaths(payloadPaths)
  const preservedObjectPaths = new Set<string>()
  const resolvedRows = await Promise.all(
    listPayload.records.map(async (row) => {
      const labeled = await applyM2ODisplayTemplates(collection, row, rowPaths)
      for (const path of labeled.preservedObjectPaths) preservedObjectPaths.add(path)
      return applyNumberDisplayFormats(collection, labeled.payload, rowPaths)
    }),
  )
  const nestingAwareMapping = rewriteWholeM2OColumnPathsForNesting(
    listMapping,
    preservedObjectPaths,
  )
  const { mapping: formattedMapping, records: formattedRows } =
    applyTableItemDateFormatsToRecords(nestingAwareMapping, resolvedRows)
  const resolvedPayload = {
    ...listPayload,
    records: formattedRows,
  } as Record<string, unknown>
  // Labels + Currency first, then Tree `main.sort` within each group (sort needs display labels).
  await enrichItemGroupPriceRowsForDocuments(resolvedPayload, { collection })
  const sortedPayload = sortMappedTableArrays(formattedMapping, resolvedPayload)
  const spec = mappingSpecFromStored(formattedMapping, template)
  return applyFieldMapping(sortedPayload, spec, template as never)
}

export function serializeFieldMappingForSave(
  spec: FieldMappingSpec | null,
): Record<string, unknown> | null {
  if (!spec?.rules?.length) return null
  return buildMappingResultFromRules(spec.rules) as unknown as Record<string, unknown>
}

function templateShapeFromBody(body: Record<string, unknown>): DocTemplateShape {
  // Strip design-time values so mapping does not keep sample "Product" / "test".
  if (body.kind === 'document') {
    return buildTemplateExport(body as never) as DocTemplateShape
  }
  const exported = buildTemplateExport({
    kind: 'document',
    time: Date.now(),
    blocks: (body.blocks as unknown[]) ?? [],
    fieldSchemas: (body.fieldSchemas as Record<string, unknown>) ?? {},
    pageSetup: (body.pageSetup as Record<string, unknown>) ?? {},
  } as never) as DocTemplateShape
  return {
    blocks: (exported.blocks as unknown[]) ?? [],
    fieldSchemas: (exported.fieldSchemas as Record<string, unknown>) ?? {},
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

/**
 * Resolve a relative table column path (`$item`, `$item.name`, `price`) against a row.
 * Matches Helix absolute joining (`$item.x` → row property `item.x`), not DocEngine's
 * `$item` = current-row alias.
 */
function resolveRowColumnValue(
  row: Record<string, unknown>,
  itemPath: string,
): unknown {
  const { path } = splitMappingPathAndFormat(itemPath)
  let relative = path.trim()
  if (relative.startsWith('$payload.')) {
    relative = relative.slice('$payload.'.length)
  } else if (relative.startsWith('$')) {
    relative = relative.slice(1)
  }

  if (!relative) return undefined
  const segments = relative.split('.').filter(Boolean)
  let current: unknown = row
  for (const segment of segments) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function displaySortKey(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>
    // Prefer Display Template stamp, then common label fields (Item often uses description).
    const label =
      row[HELIX_M2O_DISPLAY_LABEL] ??
      row.description ??
      row.name ??
      row.title ??
      row.label
    if (label != null && label !== '') return String(label)
    if (row.id != null) return String(row.id)
  }
  return ''
}

/**
 * Pick the table column to sort by — prefer `item`, then any `$item…` mapping, else first column.
 */
function pickTableSortItemPath(items: Record<string, unknown>): string | null {
  const entries = Object.entries(items).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  if (entries.length === 0) return null

  const byKey = entries.find(([key]) => key.toLowerCase() === 'item')
  if (byKey) return byKey[1]

  const byItemPath = entries.find(([, path]) => {
    const clean = splitMappingPathAndFormat(path).path
    return (
      clean === '$item' ||
      clean.startsWith('$item.') ||
      clean === 'item' ||
      clean.startsWith('item.')
    )
  })
  if (byItemPath) return byItemPath[1]

  return entries[0]?.[1] ?? null
}

function getPayloadValueAtPath(
  payload: Record<string, unknown>,
  absoluteSource: string,
): unknown {
  const stripped = absoluteSource.trim().replace(/^\$payload\.?/, '')
  if (!stripped) return payload
  const segments = stripped.split('.').filter(Boolean)
  let current: unknown = payload
  for (const segment of segments) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function setPayloadValueAtPath(
  payload: Record<string, unknown>,
  absoluteSource: string,
  value: unknown,
): void {
  const stripped = absoluteSource.trim().replace(/^\$payload\.?/, '')
  if (!stripped) return
  const segments = stripped.split('.').filter(Boolean)
  if (segments.length === 0) return

  let current: Record<string, unknown> = payload
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const next = current[segment]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
}

const LOCALE_SORT: Intl.CollatorOptions = { sensitivity: 'base', numeric: true }

/** Tables fed by the synthetic group→price flatten keep group order, not Item A–Z. */
function isItemGroupTreeRowsSource(source: string): boolean {
  const stripped = source.trim().replace(/^\$payload\.?/, '')
  return (
    stripped === ITEM_GROUP_TREE_ROWS_KEY ||
    stripped.endsWith(`.${ITEM_GROUP_TREE_ROWS_KEY}`)
  )
}

function asRowRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

/** Detect group shells (group_* + children[]) even when `_source` path detection fails. */
function rowsLookLikeItemGroupTreeRows(rows: unknown[]): boolean {
  if (rows.length === 0) return false
  const sample = asRowRecord(rows[0])
  return (
    sample.group_id != null &&
    sample.group_id !== '' &&
    typeof sample.group_path === 'string' &&
    Array.isArray(sample.children)
  )
}

function readTreeItemSortFromPayload(
  payload: Record<string, unknown>,
): DataTableSortConfig | null {
  const raw = payload[ITEM_GROUP_TREE_ITEM_SORT_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const field = typeof (raw as DataTableSortConfig).field === 'string'
    ? (raw as DataTableSortConfig).field.trim()
    : ''
  if (!field) return null
  const order = (raw as DataTableSortConfig).order === -1 ? -1 : 1
  return { field, order }
}

/**
 * Sort key for price rows: Tree `main.sort` field Display Template when M2O,
 * else mapping Item column path. Matches Related Item Price / Tree default sort.
 */
function itemPriceDisplaySortKey(
  row: Record<string, unknown>,
  itemSortPath: string | null,
  treeSortField?: string | null,
): string {
  const sortField = treeSortField?.trim() || ''
  if (sortField) {
    const related = resolveRowColumnValue(row, sortField)
    const fromTemplate = displaySortKey(related)
    if (fromTemplate) return fromTemplate
  }
  const item = row.item
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const fromTemplate = displaySortKey(item)
    if (fromTemplate) return fromTemplate
  }
  if (itemSortPath) {
    const fromPath = displaySortKey(resolveRowColumnValue(row, itemSortPath))
    if (fromPath) return fromPath
  }
  return displaySortKey(
    row.helixItemLabel ?? row.helixItem_description ?? row[HELIX_M2O_DISPLAY_LABEL],
  )
}

function sortPriceChildrenByItem(
  children: unknown[],
  itemSortPath: string | null,
  treeSort: DataTableSortConfig | null,
): Array<Record<string, unknown>> {
  const list = children
    .filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === 'object' && !Array.isArray(row),
    )
    .map((row) => ({ ...row }))
  if (list.length < 2) return list
  const direction = treeSort?.order === -1 ? -1 : 1
  const field = treeSort?.field ?? null
  return list.sort((left, right) => {
    const cmp = itemPriceDisplaySortKey(left, itemSortPath, field).localeCompare(
      itemPriceDisplaySortKey(right, itemSortPath, field),
      undefined,
      LOCALE_SORT,
    )
    return cmp * direction
  })
}

/**
 * Sort group shells by DFS `tree_index` / `group_path`.
 * Sort nested `children` / `item_prices` by Tree Item sort / Display Template.
 */
function sortItemGroupTreeRows(
  rows: unknown[],
  itemSortPath: string | null,
  treeSort: DataTableSortConfig | null = null,
): unknown[] {
  const sortedShells = [...rows].sort((left, right) => {
    const leftRow = asRowRecord(left)
    const rightRow = asRowRecord(right)

    const leftIndex = Number(leftRow.tree_index)
    const rightIndex = Number(rightRow.tree_index)
    if (Number.isFinite(leftIndex) && Number.isFinite(rightIndex) && leftIndex !== rightIndex) {
      return leftIndex - rightIndex
    }

    return String(leftRow.group_path ?? '').localeCompare(
      String(rightRow.group_path ?? ''),
      undefined,
      LOCALE_SORT,
    )
  })

  return sortedShells.map((entry) => {
    const row = asRowRecord(entry)
    const children = Array.isArray(row.children) ? row.children : null
    const itemPrices = Array.isArray(row.item_prices) ? row.item_prices : null
    const next: Record<string, unknown> = { ...row }
    if (children) {
      next.children = sortPriceChildrenByItem(children, itemSortPath, treeSort)
    }
    if (itemPrices) {
      next.item_prices = sortPriceChildrenByItem(itemPrices, itemSortPath, treeSort)
    }
    return next
  })
}

/** Walk a sourced section / table tree for the nested Item column mapping path. */
function findNestedItemSortPath(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  if (isDocTableMapping(value)) {
    const items = (value as { items: Record<string, unknown> }).items
    return pickTableSortItemPath(items)
  }

  if (isFlatSourcedColumnMap(value)) {
    const cols: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === '_source' || key === 'source') continue
      if (typeof nested === 'string') cols[key] = nested
    }
    return pickTableSortItemPath(cols)
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = findNestedItemSortPath(nested)
    if (found) return found
  }
  return null
}

/** Map `$group` / `$group_name` / `$group.name` → `$group_path` on price-list tables. */
function isLeafGroupNameColumnPath(path: string): boolean {
  const { path: clean } = splitMappingPathAndFormat(path)
  const trimmed = clean.trim()
  if (!trimmed) return false
  const relative = trimmed
    .replace(/^\$payload\.item_group_tree_rows\.children\./, '')
    .replace(/^\$payload\.item_group_tree_rows\./, '')
    .replace(/^\$payload\.item_group_tree_sections\.item_prices\./, '')
    .replace(/^\$payload\.item_group_tree_sections\./, '')
    .replace(/^\$payload\.item_group_tree\.children\.item_prices\./, '')
    .replace(/^\$/, '')
  return (
    relative === 'group' ||
    relative === 'group_name' ||
    relative === 'group.name' ||
    relative === 'children.group' ||
    relative === 'children.group_name' ||
    relative === 'children.group.name'
  )
}

function toGroupPathColumnPath(path: string): string {
  const { path: clean, format } = splitMappingPathAndFormat(path)
  const trimmed = clean.trim()
  let next = trimmed
  if (trimmed.includes('.children.') || /\$children\b/.test(trimmed)) {
    // Nested price row — keep relative `$group_path` (stamped on each child).
    next = trimmed.startsWith('$payload')
      ? trimmed.replace(
          /\.(group|group_name|group\.name)$/,
          '.group_path',
        )
      : '$group_path'
    if (next === trimmed && !trimmed.startsWith('$payload')) next = '$group_path'
  } else if (trimmed.startsWith('$payload.item_group_tree_rows.')) {
    next = '$payload.item_group_tree_rows.group_path'
  } else if (trimmed.startsWith(`$payload.${ITEM_GROUP_TREE_SECTIONS_KEY}.`)) {
    next = `$payload.${ITEM_GROUP_TREE_SECTIONS_KEY}.group_path`
  } else if (trimmed.startsWith('$')) {
    next = '$group_path'
  } else {
    next = 'group_path'
  }
  return format ? `${next}#${format}` : next
}

function isItemGroupTreeSectionsSource(source: string): boolean {
  const stripped = source.trim().replace(/^\$payload\.?/, '')
  return (
    stripped === ITEM_GROUP_TREE_SECTIONS_KEY ||
    stripped.endsWith(`.${ITEM_GROUP_TREE_SECTIONS_KEY}`)
  )
}

function isItemGroupTreeSource(source: string): boolean {
  const stripped = source.trim().replace(/^\$payload\.?/, '')
  return (
    stripped === ITEM_GROUP_TREE_KEY || stripped.endsWith(`.${ITEM_GROUP_TREE_KEY}`)
  )
}

function isNestedPriceArraySource(source: string): boolean {
  const trimmed = source.trim()
  return (
    trimmed === '$children' ||
    trimmed === 'children' ||
    trimmed === '$children.item_prices' ||
    trimmed === 'children.item_prices' ||
    trimmed === '$item_prices' ||
    trimmed === 'item_prices' ||
    trimmed === '$item_group_tree.children.item_prices'
  )
}

/**
 * `$item.name` / `$item.description` on item_price rows are often SKU or stale
 * schema fields — map to whole `$item` so Display Template label is used
 * (same name shown in the object list Item column).
 */
function isItemNameCodePath(path: string): boolean {
  const { path: clean } = splitMappingPathAndFormat(path)
  const trimmed = clean.trim()
  return (
    trimmed === '$item.name' ||
    trimmed === 'item.name' ||
    trimmed.endsWith('.item.name') ||
    trimmed === '$item.description' ||
    trimmed === 'item.description' ||
    trimmed.endsWith('.item.description')
  )
}

function toItemDisplayPath(path: string): string {
  const { format } = splitMappingPathAndFormat(path)
  const next = '$item'
  return format ? `${next}#${format}` : next
}

/**
 * Currency / Number interface options for every numeric field on the price collection
 * (`price` → e.g. `68.88 USD`), used for `$children` / `item_prices` tree rows.
 */
async function loadPriceRowNumberDisplayMap(
  priceCollection: string,
): Promise<Map<string, NumberDisplayOptions>> {
  const displayByField = new Map<string, NumberDisplayOptions>()
  const fields = await getCachedCollectionFields(priceCollection)
  for (const definition of fields) {
    const name = definition.field?.trim()
    if (!name) continue
    const options = resolveNumberDisplayOptions(definition)
    if (options) displayByField.set(name, options)
  }
  return displayByField
}

function applyNumberDisplayToPriceRows(
  prices: unknown,
  displayByField: Map<string, NumberDisplayOptions>,
): void {
  if (!Array.isArray(prices) || displayByField.size === 0) return
  for (const row of prices) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const priceRow = row as Record<string, unknown>
    for (const [field, options] of displayByField) {
      if (!Object.prototype.hasOwnProperty.call(priceRow, field)) continue
      const formatted = formatNumberDisplayValue(priceRow[field], options)
      if (formatted != null) priceRow[field] = formatted
    }
  }
}

/**
 * Ensure each price row has group_* stamps and `item.__helixDisplayLabel`
 * so `$item` / `$item.description` resolve from the real nested `item` object
 * (visible in the designer source schema — no synthetic helixItem_* paths).
 * Also formats Currency / Number fields (e.g. `price`) like the object list.
 */
async function enrichItemGroupPriceRowsForDocuments(
  payload: Record<string, unknown>,
  options?: { collection?: string | null },
): Promise<void> {
  const labelCache = new Map<string, string>()
  const docCollection = options?.collection?.trim() || ''
  let priceCollection = docCollection || ITEM_PRICE_COLLECTION
  if (docCollection) {
    try {
      const treeOpts = await resolveItemGroupPriceTreeOptionsFromContext(docCollection)
      if (treeOpts.itemPriceCollection?.trim()) {
        priceCollection = treeOpts.itemPriceCollection.trim()
      }
    } catch {
      // List/report collection is often item_price itself.
      priceCollection = docCollection
    }
  }
  const numberDisplayByField = await loadPriceRowNumberDisplayMap(priceCollection)

  const enrichPriceList = async (
    prices: unknown,
    shellMeta?: Record<string, unknown> | null,
  ) => {
    if (!Array.isArray(prices)) return
    for (const row of prices) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const priceRow = row as Record<string, unknown>
      if (shellMeta) {
        for (const key of ['group_id', 'group_name', 'group_path', 'depth'] as const) {
          if (
            (priceRow[key] == null || priceRow[key] === '') &&
            shellMeta[key] != null &&
            shellMeta[key] !== ''
          ) {
            priceRow[key] = shellMeta[key]
          }
        }
      }
      const current = priceRow.item
      if (current == null || current === '') continue
      const label = await resolveM2ODisplayValue('item', current, labelCache)
      if (label == null || label === '') continue
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        const itemRow = current as Record<string, unknown>
        itemRow[HELIX_M2O_DISPLAY_LABEL] = label
        // Keep `$item.description` filled when Display Template is description.
        if (itemRow.description == null || itemRow.description === '') {
          itemRow.description = label
        }
      } else {
        priceRow.item = {
          id: current,
          description: label,
          [HELIX_M2O_DISPLAY_LABEL]: label,
        }
      }
    }
    applyNumberDisplayToPriceRows(prices, numberDisplayByField)
  }

  const rows = payload[ITEM_GROUP_TREE_ROWS_KEY]
  if (Array.isArray(rows)) {
    for (const shell of rows) {
      if (!shell || typeof shell !== 'object' || Array.isArray(shell)) continue
      const shellRow = shell as Record<string, unknown>
      await enrichPriceList(shellRow.children, shellRow)
    }
  }

  const sections = payload[ITEM_GROUP_TREE_SECTIONS_KEY]
  if (Array.isArray(sections)) {
    for (const section of sections) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) continue
      await enrichPriceList((section as Record<string, unknown>).item_prices)
    }
  }

  const walkTree = async (nodes: unknown): Promise<void> => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue
      const record = node as Record<string, unknown>
      await enrichPriceList(record.item_prices)
      await walkTree(record.children)
    }
  }
  await walkTree(payload[ITEM_GROUP_TREE_KEY])

  // Tree settings `main.sort` (e.g. Item A→Z) — always after labels so M2O Display Template sorts.
  const treeSort = readTreeItemSortFromPayload(payload)
  const treeRows = payload[ITEM_GROUP_TREE_ROWS_KEY]
  if (Array.isArray(treeRows) && treeRows.length > 0) {
    payload[ITEM_GROUP_TREE_ROWS_KEY] = sortItemGroupTreeRows(treeRows, null, treeSort)
  }
  const treeSections = payload[ITEM_GROUP_TREE_SECTIONS_KEY]
  if (Array.isArray(treeSections) && treeSections.length > 0) {
    payload[ITEM_GROUP_TREE_SECTIONS_KEY] = sortItemGroupTreeRows(
      treeSections,
      null,
      treeSort,
    )
  }
}

/** Match typical DocEngine table column keys (schema is case-sensitive on read). */
function canonicalizePriceListColumnKey(key: string): string {
  const lower = key.toLowerCase()
  if (lower === 'item') return 'Item'
  if (lower === 'group') return 'Group'
  if (lower === 'price') return 'Price'
  return key
}

/**
 * DocEngine table resolution only reads string column paths. Nested maps like
 * `{ Item: { item: "$item.name", group: "$group.name", price: "$price" } }`
 * are skipped at PDF time — flatten them to top-level string columns.
 * Also canonicalizes `item`/`group`/`price` → `Item`/`Group`/`Price`.
 */
function flattenNestedPriceListColumns(
  items: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(items)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !isTableMappingObject(value)
    ) {
      const nested = value as Record<string, unknown>
      const entries = Object.entries(nested)
      if (
        entries.length > 0 &&
        entries.every(([, child]) => typeof child === 'string')
      ) {
        for (const [nestedKey, nestedVal] of entries) {
          out[canonicalizePriceListColumnKey(nestedKey)] = nestedVal
        }
        continue
      }
    }
    out[canonicalizePriceListColumnKey(key)] = value
  }
  return out
}

/** Deep-rewrite column path strings inside nested DocEngine column maps. */
function rewritePriceListColumnPaths(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const rewritten: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === 'string') {
      if (isItemNameCodePath(nested)) {
        rewritten[key] = toItemDisplayPath(nested)
      } else if (isLeafGroupNameColumnPath(nested)) {
        rewritten[key] = toGroupPathColumnPath(nested)
      } else {
        rewritten[key] = nested
      }
      continue
    }
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      if (isTableMappingObject(nested)) {
        rewritten[key] = nested
      } else {
        rewritten[key] = rewritePriceListColumnPaths(
          nested as Record<string, unknown>,
        )
      }
      continue
    }
    rewritten[key] = nested
  }
  return flattenNestedPriceListColumns(rewritten)
}

/**
 * Normalize a flat `{ _source: "$children", Item: "$item", … }` map into a
 * DocEngine table `{ _source, items }` so PDF resolution does not skip columns.
 */
function normalizeFlatSourcedColumnMap(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const source = getTableMappingSourcePath(value)
  const columns: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (key === '_source' || key === 'source') continue
    columns[key] = nested
  }
  return {
    _source: source,
    source,
    items: rewritePriceListColumnPaths(columns),
  }
}

function rewriteNestedPriceTable(
  columnValue: Record<string, unknown>,
  parentSource: string,
): { table: Record<string, unknown>; nestedArraySource: string } {
  const nestedSource = getTableMappingSourcePath(columnValue)
  const useChildren =
    isItemGroupTreeRowsSource(parentSource) ||
    isItemGroupTreeSource(parentSource) ||
    nestedSource.includes('children')
  const nestedArraySource = useChildren ? '$children' : '$item_prices'

  if (isDocTableMapping(columnValue)) {
    const nestedTable = columnValue as Record<string, unknown> & {
      items: Record<string, unknown>
    }
    return {
      nestedArraySource,
      table: {
        ...nestedTable,
        items: rewritePriceListColumnPaths(nestedTable.items),
        _source: nestedArraySource,
        source: nestedArraySource,
      },
    }
  }

  // Flat `{ _source, Item, Price, Group }` or `{ _source, Item: { item, group, price } }`
  return {
    nestedArraySource,
    table: normalizeFlatSourcedColumnMap({
      ...columnValue,
      _source: nestedArraySource,
      source: nestedArraySource,
    }),
  }
}

/**
 * Normalize nested price-list mappings:
 * - `item_group_tree` + `$children.item_prices` → `item_group_tree_rows` + `$children`
 * - `item_group_tree_sections` + `$item_prices` stays valid
 * - `item_group_tree_rows` nested prices use `$children`
 * - flat sourced column maps → proper `{ _source, items }` tables
 */
function rewriteItemGroupTreeNestedSources(
  mapping: Record<string, unknown>,
): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((entry) => visit(entry))
    if (!value || typeof value !== 'object') return value

    // Sourced section (`_source` + sibling fields, including a nested table named `items`).
    if (isSourcedSectionFieldMap(value)) {
      const section = value as Record<string, unknown>
      const source = getTableMappingSourcePath(section)
      const out: Record<string, unknown> = {}
      let nestedPriceSource: string | null = null
      for (const [key, nested] of Object.entries(section)) {
        if (key === '_source' || key === 'source') {
          out[key] = nested
          continue
        }
        if (
          nested &&
          typeof nested === 'object' &&
          !Array.isArray(nested) &&
          (isDocTableMapping(nested) ||
            isFlatSourcedColumnMap(nested) ||
            isNestedPriceArraySource(getTableMappingSourcePath(nested)))
        ) {
          const nestedSource = getTableMappingSourcePath(nested)
          if (isNestedPriceArraySource(nestedSource) || isFlatSourcedColumnMap(nested)) {
            const rewritten = rewriteNestedPriceTable(
              nested as Record<string, unknown>,
              source,
            )
            nestedPriceSource = rewritten.nestedArraySource
            out[key] = visit(rewritten.table)
            continue
          }
        }
        out[key] = visit(nested)
      }
      let nextSource = source
      if (isItemGroupTreeSource(source) && nestedPriceSource) {
        nextSource = `$payload.${ITEM_GROUP_TREE_ROWS_KEY}`
      }
      if (typeof section._source === 'string') out._source = nextSource
      if (typeof section.source === 'string') out.source = nextSource
      return out
    }

    if (isFlatSourcedColumnMap(value)) {
      return visit(normalizeFlatSourcedColumnMap(value as Record<string, unknown>))
    }

    if (isDocTableMapping(value)) {
      const source = getTableMappingSourcePath(value)
      const table = value as Record<string, unknown> & {
        items: Record<string, unknown>
        _source?: string
        source?: string
      }
      const nextItems: Record<string, unknown> = {}
      let nestedPriceSource: string | null = null
      for (const [columnKey, columnValue] of Object.entries(table.items)) {
        if (
          columnValue &&
          typeof columnValue === 'object' &&
          !Array.isArray(columnValue) &&
          (isDocTableMapping(columnValue) || isFlatSourcedColumnMap(columnValue))
        ) {
          const nestedSource = getTableMappingSourcePath(columnValue)
          if (isNestedPriceArraySource(nestedSource)) {
            const rewritten = rewriteNestedPriceTable(
              columnValue as Record<string, unknown>,
              source,
            )
            nestedPriceSource = rewritten.nestedArraySource
            nextItems[columnKey] = visit(rewritten.table)
            continue
          }
        }
        // DocEngine sometimes nests column maps under a plain object (e.g. "Item": { item, group, price }).
        if (
          columnValue &&
          typeof columnValue === 'object' &&
          !Array.isArray(columnValue) &&
          (isItemGroupTreeRowsSource(source) ||
            isItemGroupTreeSectionsSource(source) ||
            isNestedPriceArraySource(source))
        ) {
          nextItems[columnKey] = rewritePriceListColumnPaths(
            columnValue as Record<string, unknown>,
          )
          continue
        }
        nextItems[columnKey] = visit(columnValue)
      }

      let nextSource = source
      if (isItemGroupTreeSource(source) && nestedPriceSource) {
        // Prefer rows shells (`children`) over recursive tree for DocEngine.
        nextSource = `$payload.${ITEM_GROUP_TREE_ROWS_KEY}`
      }

      const nextTable: Record<string, unknown> = {
        ...table,
        items: flattenNestedPriceListColumns(nextItems),
      }
      if (typeof table._source === 'string') nextTable._source = nextSource
      if (typeof table.source === 'string') nextTable.source = nextSource
      return nextTable
    }

    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = visit(nested)
    }
    return out
  }

  return visit(mapping) as Record<string, unknown>
}

/**
 * Prefer full tree path in the Group column for price-list tables.
 * Existing mappings often bind `$group_name` (leaf only).
 */
function rewriteItemGroupTreeRowsGroupColumns(
  mapping: Record<string, unknown>,
): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((entry) => visit(entry))
    if (!value || typeof value !== 'object') return value

    const rewriteColumnValue = (columnValue: unknown, usePath: boolean): unknown => {
      if (typeof columnValue === 'string') {
        if (usePath && isItemNameCodePath(columnValue)) {
          return toItemDisplayPath(columnValue)
        }
        if (usePath && isLeafGroupNameColumnPath(columnValue)) {
          return toGroupPathColumnPath(columnValue)
        }
        return columnValue
      }
      if (
        columnValue &&
        typeof columnValue === 'object' &&
        !Array.isArray(columnValue) &&
        !isDocTableMapping(columnValue)
      ) {
        return rewritePriceListColumnPaths(columnValue as Record<string, unknown>)
      }
      return visit(columnValue)
    }

    if (isSourcedSectionFieldMap(value)) {
      const section = value as Record<string, unknown>
      const source = getTableMappingSourcePath(section)
      const usePath =
        isItemGroupTreeRowsSource(source) || isItemGroupTreeSectionsSource(source)
      const out: Record<string, unknown> = {}
      for (const [key, nested] of Object.entries(section)) {
        if (key === '_source' || key === 'source') {
          out[key] = nested
          continue
        }
        if (typeof nested === 'string' && usePath) {
          out[key] = rewriteColumnValue(nested, true)
          continue
        }
        out[key] = visit(nested)
      }
      return out
    }

    if (isDocTableMapping(value)) {
      const source = getTableMappingSourcePath(value)
      const table = value as Record<string, unknown> & {
        items: Record<string, unknown>
      }
      const usePath =
        isItemGroupTreeRowsSource(source) ||
        isItemGroupTreeSectionsSource(source) ||
        isNestedPriceArraySource(source)
      const nextItems: Record<string, unknown> = {}
      for (const [columnKey, columnValue] of Object.entries(table.items)) {
        nextItems[columnKey] = rewriteColumnValue(columnValue, usePath)
      }
      return {
        ...table,
        items: usePath ? flattenNestedPriceListColumns(nextItems) : nextItems,
      }
    }

    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = visit(nested)
    }
    return out
  }

  return visit(mapping) as Record<string, unknown>
}

/**
 * Sort DocEngine table `_source` arrays by the Item Display Template (locale-aware),
 * matching Related Item Price default sort (Item ascending).
 * `item_group_tree_rows` / sections keep DFS group order; Item A–Z within each group.
 */
function sortMappedTableArrays(
  mapping: Record<string, unknown>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const treeSort = readTreeItemSortFromPayload(payload)

  const sortGroupTreePayload = (
    absoluteSource: string,
    itemSortPath: string | null,
  ): void => {
    if (!absoluteSource.startsWith('$payload')) return
    const rows = getPayloadValueAtPath(payload, absoluteSource)
    if (!Array.isArray(rows) || rows.length === 0) return
    if (
      isItemGroupTreeRowsSource(absoluteSource) ||
      isItemGroupTreeSectionsSource(absoluteSource) ||
      rowsLookLikeItemGroupTreeRows(rows)
    ) {
      setPayloadValueAtPath(
        payload,
        absoluteSource,
        sortItemGroupTreeRows(rows, itemSortPath, treeSort),
      )
    }
  }

  const visit = (value: unknown, parentPayloadSource?: string): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, parentPayloadSource)
      return
    }
    if (!value || typeof value !== 'object') return

    if (isSourcedSectionFieldMap(value) || isFlatSourcedColumnMap(value)) {
      const rawSource = getTableMappingSourcePath(value)
      const absoluteSource = absolutizeMappingSource(rawSource, parentPayloadSource)
      const itemSortPath = findNestedItemSortPath(value)
      sortGroupTreePayload(absoluteSource, itemSortPath)

      const nextParent = absoluteSource.startsWith('$payload')
        ? absoluteSource
        : parentPayloadSource
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (key === '_source' || key === 'source') continue
        visit(nested, nextParent)
      }
      return
    }

    if (isDocTableMapping(value)) {
      const rawSource = getTableMappingSourcePath(value)
      const source = absolutizeMappingSource(rawSource, parentPayloadSource)
      const items = (value as { items: Record<string, unknown> }).items
      const sortPath = pickTableSortItemPath(items)

      if (
        isItemGroupTreeRowsSource(source) ||
        isItemGroupTreeSectionsSource(source)
      ) {
        sortGroupTreePayload(source, sortPath)
        visit(items, source.startsWith('$payload') ? source : parentPayloadSource)
        return
      }

      // Nested `$children` / `$item_prices` under group shells — already sorted above.
      if (!source.startsWith('$payload')) {
        visit(items, parentPayloadSource)
        return
      }

      const rows = getPayloadValueAtPath(payload, source)
      if (!Array.isArray(rows) || rows.length < 2) {
        visit(items, source)
        return
      }

      if (rowsLookLikeItemGroupTreeRows(rows)) {
        setPayloadValueAtPath(
          payload,
          source,
          sortItemGroupTreeRows(rows, sortPath, treeSort),
        )
        visit(items, source)
        return
      }

      if (!sortPath && !treeSort) {
        visit(items, source)
        return
      }

      const direction = treeSort?.order === -1 ? -1 : 1
      const field = treeSort?.field ?? null
      const sorted = [...rows].sort((left, right) => {
        const leftRow = asRowRecord(left)
        const rightRow = asRowRecord(right)
        const cmp = itemPriceDisplaySortKey(leftRow, sortPath, field).localeCompare(
          itemPriceDisplaySortKey(rightRow, sortPath, field),
          undefined,
          LOCALE_SORT,
        )
        return cmp * direction
      })
      setPayloadValueAtPath(payload, source, sorted)
      visit(items, source)
      return
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
      visit(nested, parentPayloadSource)
    }
  }

  visit(mapping)
  return payload
}

/** Canonicalize price-list table column keys (`item` → `Item`) without rewriting paths. */
function canonicalizePriceListTableKeys(
  mapping: Record<string, unknown>,
): Record<string, unknown> {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((entry) => visit(entry))
    if (!value || typeof value !== 'object') return value

    if (isDocTableMapping(value)) {
      const table = value as { items: Record<string, unknown> }
      const items: Record<string, unknown> = {}
      for (const [key, nested] of Object.entries(table.items)) {
        items[canonicalizePriceListColumnKey(key)] = visit(nested)
      }
      return { ...value, items }
    }

    if (isSourcedSectionFieldMap(value) || isFlatSourcedColumnMap(value)) {
      const out: Record<string, unknown> = {}
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (key === '_source' || key === 'source') {
          out[key] = nested
          continue
        }
        out[key] = visit(nested)
      }
      return out
    }

    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = visit(nested)
    }
    return out
  }

  return visit(mapping) as Record<string, unknown>
}

export async function applyDocFieldMapping(
  collection: string,
  mapping: Record<string, unknown>,
  payload: Record<string, unknown>,
  template: DocTemplateShape,
) {
  const normalizedMapping = canonicalizePriceListTableKeys(
    rewriteItemGroupTreeRowsGroupColumns(
      rewriteItemGroupTreeNestedSources(normalizeMappingFormatSuffixes(mapping)),
    ),
  )
  const payloadPaths = extractPayloadPaths(normalizedMapping)
  const labeled = await applyM2ODisplayTemplates(collection, payload, payloadPaths)
  await enrichItemGroupPriceRowsForDocuments(labeled.payload, { collection })
  const nestingAwareMapping = rewriteWholeM2OColumnPathsForNesting(
    normalizedMapping,
    labeled.preservedObjectPaths,
  )
  const spec = mappingSpecFromStored(nestingAwareMapping, template)
  const numbered = await applyNumberDisplayFormats(
    collection,
    labeled.payload,
    payloadPaths,
  )
  const resolvedPayload = sortMappedTableArrays(nestingAwareMapping, numbered)
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

  const crmPaths = stripItemGroupPriceTreePayloadPaths(payloadPaths)
  const relatedRefs = await listParentRelatedCollections(collection)
  const plan = buildPayloadFetchPlan(collection, crmPaths, relatedRefs)
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

  if (mappingNeedsItemGroupPriceTree(payloadPaths)) {
    // Copied from fullSample (schema-shaped via Tree-resolved collections).
    if (fullSample[ITEM_GROUP_TREE_KEY] != null) {
      sample[ITEM_GROUP_TREE_KEY] = fullSample[ITEM_GROUP_TREE_KEY]
    }
    if (fullSample[ITEM_GROUP_TREE_ROWS_KEY] != null) {
      sample[ITEM_GROUP_TREE_ROWS_KEY] = fullSample[ITEM_GROUP_TREE_ROWS_KEY]
    }
    if (fullSample[ITEM_GROUP_TREE_SECTIONS_KEY] != null) {
      sample[ITEM_GROUP_TREE_SECTIONS_KEY] = fullSample[ITEM_GROUP_TREE_SECTIONS_KEY]
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
