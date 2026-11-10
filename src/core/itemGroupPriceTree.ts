import {
  buildHierarchyTreeNodes,
  type HierarchyTreeNode,
} from '@/core/hierarchyTree'
import {
  relatedCollectionForCollectionField,
  relationField,
  relationForChildCollection,
  relationManyCollection,
  relationRelatedCollection,
} from '@/core/relationHelpers'
import { bridgeReadItems } from '@/core/graphql/itemsBridge'
import { fetchItemGroupPriceTreeFromOptions } from '@/core/graphql/itemGroupPriceTreeApi'
import {
  fetchCollectionDisplayTemplate,
  getCachedCollectionFields,
  getCachedRelations,
  listParentRelatedCollections,
} from '@/modules/entities/services/collectionSchema'
import { loadTreeTableSettings } from '@/modules/entities/services/treeTableSettings'
import { extractTemplateFields } from '@/modules/entities/utils/recordDisplay'
import type { DataTableSortConfig, RelationDefinition } from '@/interfaces'

/** Synthetic DocEngine / export payload keys. */
export const ITEM_GROUP_TREE_KEY = 'item_group_tree'
export const ITEM_GROUP_TREE_ROWS_KEY = 'item_group_tree_rows'
/**
 * One-level list of groups that have prices (tree order) — DocEngine-friendly
 * for “Group header + item_prices table” without recursive `$children`.
 */
export const ITEM_GROUP_TREE_SECTIONS_KEY = 'item_group_tree_sections'
/** Stashed on doc payload so mapping sort can honor Tree `main.sort`. */
export const ITEM_GROUP_TREE_ITEM_SORT_KEY = '__coreEngineItemGroupTreeItemSort'

function isO2MAliasField(
  relations: RelationDefinition[],
  collection: string,
  field: string,
): boolean {
  return relations.some(
    (item) =>
      (item.meta?.one_collection ?? '').toLowerCase() === collection.toLowerCase() &&
      (item.meta?.one_field ?? '').toLowerCase() === field.toLowerCase(),
  )
}

export interface ItemGroupPriceTreeNode {
  id: string
  name: string
  parent: string | null
  children: ItemGroupPriceTreeNode[]
  item_prices: Array<Record<string, unknown>>
}

/**
 * One group shell for DocEngine: group metadata only + nested item_price rows.
 * `_source: $payload.item_group_tree_rows` then nested `_source: $children`.
 */
export interface ItemGroupPriceTreeRow {
  group_id: string
  group_name: string
  /** Full path including parents, e.g. "Product / Spare Parts". */
  group_path: string
  depth: number
  /** DFS visit order — use for sort; do not sort by bare group_name. */
  tree_index: number
  /** Nested item_price records (no group_* fields duplicated here). */
  children: Array<Record<string, unknown>>
}

/** Flat section for DocEngine: one group header + its item_prices. */
export interface ItemGroupPriceTreeSection {
  id: string
  name: string
  parent: string | null
  group_path: string
  depth: number
  tree_index: number
  item_prices: Array<Record<string, unknown>>
}

export interface ItemGroupPriceTreeResult {
  tree: ItemGroupPriceTreeNode[]
  rows: ItemGroupPriceTreeRow[]
  sections: ItemGroupPriceTreeSection[]
}

export interface LoadItemGroupPriceTreeOptions {
  priceGroupId?: string | null
  filter?: Record<string, unknown> | null
  fields?: string[] | null
  groupCollection?: string
  itemPriceCollection?: string
  groupParentField?: string
  groupLabelField?: string
  itemGroupFieldPath?: string
  priceGroupField?: string
  /** Within-group sort from Tree `main.sort` (Item Display Template when M2O). */
  itemSort?: DataTableSortConfig | null
}

/** Config blob passed to BFF `itemGroupPriceTree(config: …)`. */
export type ItemGroupPriceTreeConfig = Pick<
  LoadItemGroupPriceTreeOptions,
  | 'groupCollection'
  | 'itemPriceCollection'
  | 'groupParentField'
  | 'groupLabelField'
  | 'itemGroupFieldPath'
  | 'priceGroupField'
>

function scalarId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim()
    return text ? text : null
  }
  if (typeof value === 'object') {
    const id = (value as Record<string, unknown>).id
    if (typeof id === 'string' || typeof id === 'number') {
      const text = String(id).trim()
      return text ? text : null
    }
  }
  return null
}

function getPathValue(row: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, row)
}

/** True when a doc mapping path targets the synthetic group-price tree. */
export function isItemGroupPriceTreePayloadPath(path: string): boolean {
  const trimmed = path.trim().replace(/^\$payload\.?/, '')
  return (
    trimmed === ITEM_GROUP_TREE_KEY ||
    trimmed === ITEM_GROUP_TREE_ROWS_KEY ||
    trimmed === ITEM_GROUP_TREE_SECTIONS_KEY ||
    trimmed.startsWith(`${ITEM_GROUP_TREE_KEY}.`) ||
    trimmed.startsWith(`${ITEM_GROUP_TREE_ROWS_KEY}.`) ||
    trimmed.startsWith(`${ITEM_GROUP_TREE_SECTIONS_KEY}.`)
  )
}

export function stripItemGroupPriceTreePayloadPaths(paths: string[]): string[] {
  return paths.filter((path) => !isItemGroupPriceTreePayloadPath(path))
}

export function mappingNeedsItemGroupPriceTree(paths: string[]): boolean {
  return paths.some((path) => isItemGroupPriceTreePayloadPath(path))
}

/** Self-FK field names on a collection (M2O → same collection). */
function selfFkFields(
  relations: RelationDefinition[],
  collection: string,
): string[] {
  const needle = collection.toLowerCase()
  return relations
    .filter((item) => {
      const many = relationManyCollection(item).toLowerCase()
      const one = relationRelatedCollection(item).toLowerCase()
      const field = relationField(item).trim()
      return many === needle && one === needle && Boolean(field)
    })
    .map((item) => relationField(item).trim())
    .filter(Boolean)
}

/**
 * Resolve parent field from Tree settings or the sole self-FK on the group collection.
 * Never prefers a hard-coded API name.
 */
function resolveSelfParentField(
  relations: RelationDefinition[],
  groupCollection: string,
  configured?: string | null,
): string {
  const fromConfig = configured?.trim() || ''
  if (fromConfig) return fromConfig
  const selfFks = selfFkFields(relations, groupCollection)
  if (selfFks.length === 1) return selfFks[0]!
  if (selfFks.length === 0) {
    throw new Error(
      `No self-FK parent field found on "${groupCollection}". Configure Tree group.parentField.`,
    )
  }
  throw new Error(
    `Multiple self-FK fields on "${groupCollection}" (${selfFks.join(', ')}). Configure Tree group.parentField.`,
  )
}

/**
 * Resolve LoadItemGroupPriceTreeOptions from Tree Table settings + relations.
 *
 * Prefer Tree settings on the document/list collection itself when that layout's
 * main collection is this collection (Item Price list reports). Only fall back to
 * related-collection trees for parent docs (e.g. price_group embedding prices).
 */
export async function resolveItemGroupPriceTreeOptionsFromContext(
  docCollection: string,
): Promise<LoadItemGroupPriceTreeOptions> {
  const relations = await getCachedRelations()
  const doc = docCollection.trim()

  // 1) List collection Tree layout (table + tree list reports on item_price, etc.).
  const own = await loadTreeTableSettings(doc)
  const ownGroup = own?.group?.collection?.trim() || ''
  const ownGroupField = own?.main?.groupField?.trim() || ''
  const ownMain = (own?.main?.collection?.trim() || doc).toLowerCase()
  if (own && ownGroup && ownGroupField && ownMain === doc.toLowerCase()) {
    const groupParentField = resolveSelfParentField(
      relations,
      ownGroup,
      own.group.parentField,
    )
    return {
      groupCollection: ownGroup,
      itemPriceCollection: own.main.collection?.trim() || doc,
      groupParentField,
      groupLabelField: own.group.labelField?.trim() || 'name',
      itemGroupFieldPath: ownGroupField,
      // No parent-doc scope — list reports filter by record ids / list filters.
      priceGroupField: '',
      itemSort: own.main.sort ?? null,
    }
  }

  // 2) Parent-document tree: Tree settings on a related child collection.
  const related = await listParentRelatedCollections(doc)
  type Candidate = {
    settings: NonNullable<Awaited<ReturnType<typeof loadTreeTableSettings>>>
    itemPriceCollection: string
    score: number
  }
  const candidates: Candidate[] = []

  for (const entry of related) {
    const candidate = entry.relatedCollection?.trim()
    if (!candidate) continue
    if (!relationForChildCollection(relations, candidate, doc)) continue

    const settings = await loadTreeTableSettings(candidate)
    const groupCollection = settings?.group?.collection?.trim() || ''
    const groupField = settings?.main?.groupField?.trim() || ''
    const mainCollection = settings?.main?.collection?.trim() || ''
    if (!groupCollection || !groupField || !mainCollection) continue

    let score = 0
    if (groupCollection.toLowerCase() !== mainCollection.toLowerCase()) score += 3
    if (settings.main.sort?.field) score += 1
    if (groupField.includes('.')) score += 1
    candidates.push({ settings, itemPriceCollection: mainCollection, score })
  }

  candidates.sort((left, right) => right.score - left.score)
  const best = candidates[0]
  if (!best?.settings || !best.itemPriceCollection) {
    throw new Error(
      `No Tree Table settings found for "${doc}" (or a related collection).`,
    )
  }

  const treeSettings = best.settings
  const itemPriceCollection = best.itemPriceCollection
  const scopeRelation = relationForChildCollection(
    relations,
    itemPriceCollection,
    doc,
  )
  const priceGroupField = scopeRelation ? relationField(scopeRelation).trim() : ''
  if (!priceGroupField) {
    throw new Error(
      `No M2O from "${itemPriceCollection}" to "${doc}" for price-list scope filter.`,
    )
  }

  const groupCollection = treeSettings.group.collection.trim()
  const groupParentField = resolveSelfParentField(
    relations,
    groupCollection,
    treeSettings.group.parentField,
  )

  return {
    groupCollection,
    itemPriceCollection,
    groupParentField,
    groupLabelField: treeSettings.group.labelField?.trim() || 'name',
    itemGroupFieldPath: treeSettings.main.groupField.trim(),
    priceGroupField,
    itemSort: treeSettings.main.sort ?? null,
  }
}

/** True when Tree settings can supply `item_group_tree*` for this collection. */
export async function collectionSupportsItemGroupPriceTreeSample(
  collection: string,
): Promise<boolean> {
  const name = collection?.trim() || ''
  if (!name) return false
  try {
    await resolveItemGroupPriceTreeOptionsFromContext(name)
    return true
  } catch {
    return false
  }
}

export function toItemGroupPriceTreeConfig(
  options: LoadItemGroupPriceTreeOptions,
): ItemGroupPriceTreeConfig | null {
  const groupCollection = options.groupCollection?.trim() || ''
  const itemPriceCollection = options.itemPriceCollection?.trim() || ''
  const groupParentField = options.groupParentField?.trim() || ''
  const groupLabelField = options.groupLabelField?.trim() || ''
  const itemGroupFieldPath = options.itemGroupFieldPath?.trim() || ''
  const priceGroupField = options.priceGroupField?.trim() || ''
  // priceGroupField may be empty for list-collection Tree mode (scope via filter / ids).
  if (
    !groupCollection ||
    !itemPriceCollection ||
    !groupParentField ||
    !groupLabelField ||
    !itemGroupFieldPath
  ) {
    return null
  }
  return {
    groupCollection,
    itemPriceCollection,
    groupParentField,
    groupLabelField,
    itemGroupFieldPath,
    priceGroupField,
  }
}

function hasResolvedTreeConfig(options: LoadItemGroupPriceTreeOptions): boolean {
  return toItemGroupPriceTreeConfig(options) != null
}

/** Bucket price rows by resolved group id (path from Tree `main.groupField`). */
export function bucketItemPricesByGroupId(
  prices: Array<Record<string, unknown>>,
  itemGroupFieldPath: string,
): Map<string, Array<Record<string, unknown>>> {
  const byGroup = new Map<string, Array<Record<string, unknown>>>()
  const path = itemGroupFieldPath.trim()
  if (!path) return byGroup
  for (const row of prices) {
    const groupId = scalarId(getPathValue(row, path))
    if (!groupId) continue
    const list = byGroup.get(groupId)
    if (list) list.push(row)
    else byGroup.set(groupId, [row])
  }
  return byGroup
}

function hierarchyToPriceTree(
  nodes: HierarchyTreeNode[],
  pricesByGroupId: Map<string, Array<Record<string, unknown>>>,
  parentField: string,
): ItemGroupPriceTreeNode[] {
  return nodes.map((node) => {
    const data = (node.data ?? {}) as Record<string, unknown>
    const parentId = scalarId(data[parentField])
    return {
      id: node.key,
      name: node.label,
      parent: parentId,
      item_prices: pricesByGroupId.get(node.key) ?? [],
      children: hierarchyToPriceTree(node.children ?? [], pricesByGroupId, parentField),
    }
  })
}

/**
 * Attach item_prices to each group tree node (exact group match only — not rolled up).
 */
export function attachItemPricesToGroupTree(
  hierarchy: HierarchyTreeNode[],
  pricesByGroupId: Map<string, Array<Record<string, unknown>>>,
  parentField: string,
): ItemGroupPriceTreeNode[] {
  return hierarchyToPriceTree(hierarchy, pricesByGroupId, parentField)
}

/**
 * Groups that have prices → shells with only group_* metadata and `children`
 * holding the nested item_price records (DFS tree order).
 */
export function flattenItemGroupPriceTree(
  nodes: ItemGroupPriceTreeNode[],
  ancestors: string[] = [],
  depth = 0,
  order: { index: number } = { index: 0 },
): ItemGroupPriceTreeRow[] {
  const rows: ItemGroupPriceTreeRow[] = []
  for (const node of nodes) {
    const pathParts = [...ancestors, node.name]
    const groupPath = pathParts.join(' / ')
    if (node.item_prices.length > 0) {
      rows.push({
        group_id: node.id,
        group_name: node.name,
        group_path: groupPath,
        depth,
        tree_index: order.index,
        children: node.item_prices.map((price) => ({
          ...price,
          group_id: node.id,
          group_name: node.name,
          group_path: groupPath,
          depth,
        })),
      })
      order.index += 1
    }
    rows.push(
      ...flattenItemGroupPriceTree(node.children, pathParts, depth + 1, order),
    )
  }
  return rows
}

/**
 * Groups that have at least one item_price, in DFS tree order.
 * Use as DocEngine `_source` with nested `_source: "$item_prices"`.
 */
export function flattenItemGroupTreeSections(
  nodes: ItemGroupPriceTreeNode[],
  ancestors: string[] = [],
  depth = 0,
  order: { index: number } = { index: 0 },
): ItemGroupPriceTreeSection[] {
  const sections: ItemGroupPriceTreeSection[] = []
  for (const node of nodes) {
    const pathParts = [...ancestors, node.name]
    const groupPath = pathParts.join(' / ')
    if (node.item_prices.length > 0) {
      sections.push({
        id: node.id,
        name: node.name,
        parent: node.parent,
        group_path: groupPath,
        depth,
        tree_index: order.index,
        item_prices: node.item_prices,
      })
      order.index += 1
    }
    sections.push(
      ...flattenItemGroupTreeSections(node.children, pathParts, depth + 1, order),
    )
  }
  return sections
}

/** Build tree + flat rows from already-loaded group and price records. */
export function buildItemGroupPriceTree(
  groups: Array<Record<string, unknown>>,
  prices: Array<Record<string, unknown>>,
  options: {
    groupParentField: string
    groupLabelField: string
    itemGroupFieldPath: string
  },
): ItemGroupPriceTreeResult {
  const parentField = options.groupParentField.trim()
  const labelField = options.groupLabelField.trim() || 'name'
  const itemGroupFieldPath = options.itemGroupFieldPath.trim()

  const hierarchy = buildHierarchyTreeNodes(groups, {
    primaryKey: 'id',
    labelField,
    parentField,
  })
  const pricesByGroupId = bucketItemPricesByGroupId(prices, itemGroupFieldPath)
  const tree = attachItemPricesToGroupTree(hierarchy, pricesByGroupId, parentField)
  return {
    tree,
    rows: flattenItemGroupPriceTree(tree),
    sections: flattenItemGroupTreeSections(tree),
  }
}

function mergePriceFilters(
  priceGroupId: string | null | undefined,
  priceGroupField: string,
  extra: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const parts: Array<Record<string, unknown>> = []
  if (priceGroupId && priceGroupField) {
    parts.push({ [priceGroupField]: { _eq: priceGroupId } })
  }
  if (extra && Object.keys(extra).length > 0) {
    parts.push(extra)
  }
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  return { _and: parts }
}

/**
 * Load every price-line scalar + expand each M2O with Display Template fields
 * so DocEngine `$item` / nested M2Os resolve to full related records.
 */
async function enrichPriceFieldsWithDisplayTemplates(
  itemPriceCollection: string,
  itemGroupFieldPath: string,
  fields: string[],
): Promise<string[]> {
  const next = new Set(fields)
  const [priceFields, relations] = await Promise.all([
    getCachedCollectionFields(itemPriceCollection),
    getCachedRelations(),
  ])

  for (const definition of priceFields) {
    const name = definition.field?.trim()
    if (!name) continue
    if (isO2MAliasField(relations, itemPriceCollection, name)) continue
    next.add(name)

    const related = relatedCollectionForCollectionField(
      relations,
      itemPriceCollection,
      name,
    )
    if (!related) continue

    next.add(`${name}.id`)
    const template = await fetchCollectionDisplayTemplate(related)
    const tokens = template ? extractTemplateFields(template) : ['name']
    for (const token of tokens) {
      if (token) next.add(`${name}.${token}`)
    }
  }

  const groupPath = itemGroupFieldPath.trim()
  if (groupPath) {
    next.add(groupPath)
    next.add(`${groupPath}.id`)
    next.add(`${groupPath}.name`)
  }

  return [...next]
}

export interface ItemGroupPriceTreeSampleArgs {
  /** Schema-shaped line row (from collection field sample). */
  priceRow: Record<string, unknown>
  /** Schema-shaped group node that owns the prices. */
  groupRow: Record<string, unknown>
  /** Optional parent group for a 2-level DFS sample. */
  parentGroupRow?: Record<string, unknown> | null
  groupParentField: string
  groupLabelField: string
  /** Path on the price row used at runtime to bucket onto groups. */
  itemGroupFieldPath: string
}

function sampleRecordLabel(
  row: Record<string, unknown>,
  labelField: string,
  fallbackId: string,
): string {
  const field = labelField.trim() || 'name'
  const value = row[field]
  if (value != null && value !== '') {
    if (typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>
      return String(nested.name ?? nested.title ?? nested.label ?? nested.id ?? fallbackId)
    }
    return String(value)
  }
  return String(scalarId(row.id) ?? fallbackId)
}

/**
 * Stamp `itemGroupFieldPath` on the price row so it points at `groupRow`
 * (designer paths like `$item.group` stay consistent with Tree settings).
 */
function stampPriceRowGroupRef(
  priceRow: Record<string, unknown>,
  itemGroupFieldPath: string,
  groupRow: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...priceRow }
  const path = itemGroupFieldPath.trim()
  if (!path) return next
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0) return next
  if (segments.length === 1) {
    next[segments[0]!] = groupRow
    return next
  }
  let cursor: Record<string, unknown> = next
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]!
    const existing = cursor[key]
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      cursor[key] = { ...(existing as Record<string, unknown>) }
    } else {
      cursor[key] = {}
    }
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[segments[segments.length - 1]!] = groupRow
  return next
}

/**
 * Sample fragment for Doc Designer path discovery — structure from Tree settings,
 * price/group row shapes from schema samples (no pack field/collection names).
 */
export function buildItemGroupPriceTreeSample(
  args: ItemGroupPriceTreeSampleArgs,
): ItemGroupPriceTreeResult {
  const labelField = args.groupLabelField.trim() || 'name'
  const parentField = args.groupParentField.trim()
  const groupId = String(scalarId(args.groupRow.id) ?? 'sample-group')
  const groupName = sampleRecordLabel(args.groupRow, labelField, groupId)
  const pricedRow = stampPriceRowGroupRef(
    args.priceRow,
    args.itemGroupFieldPath,
    { ...args.groupRow, id: args.groupRow.id ?? groupId },
  )

  const leafNode: ItemGroupPriceTreeNode = {
    id: groupId,
    name: groupName,
    parent: null,
    item_prices: [pricedRow],
    children: [],
  }

  let tree: ItemGroupPriceTreeNode[]
  if (args.parentGroupRow && parentField) {
    const parentId = String(scalarId(args.parentGroupRow.id) ?? 'sample-parent-group')
    const parentName = sampleRecordLabel(args.parentGroupRow, labelField, parentId)
    leafNode.parent = parentId
    tree = [
      {
        id: parentId,
        name: parentName,
        parent: null,
        item_prices: [],
        children: [leafNode],
      },
    ]
  } else {
    tree = [leafNode]
  }

  return {
    tree,
    rows: flattenItemGroupPriceTree(tree),
    sections: flattenItemGroupTreeSections(tree),
  }
}

/**
 * Load via dual bridgeReadItems (custom collection/field paths).
 * Prefer {@link loadItemGroupPriceTree} which uses the BFF query when config is resolved.
 * Use this directly for list reports that filter by `id: { _in: recordIds }` so the
 * bridge honors the id list (BFF may ignore it when priceGroupField is empty).
 */
export async function loadItemGroupPriceTreeViaBridge(
  options: LoadItemGroupPriceTreeOptions,
): Promise<ItemGroupPriceTreeResult> {
  const config = toItemGroupPriceTreeConfig(options)
  if (!config) {
    throw new Error(
      'item_group_tree requires resolved Tree settings (group/parent/label/groupField/scope).',
    )
  }

  const {
    groupCollection,
    itemPriceCollection,
    groupParentField,
    groupLabelField,
    itemGroupFieldPath,
    priceGroupField,
  } = config

  let requestedFields = options.fields?.length ? [...options.fields] : ['id']
  if (!requestedFields.includes(itemGroupFieldPath)) {
    requestedFields.push(itemGroupFieldPath)
  }
  if (priceGroupField && !requestedFields.includes(priceGroupField)) {
    requestedFields.push(priceGroupField)
  }
  if (!requestedFields.includes('id')) {
    requestedFields.unshift('id')
  }
  requestedFields = await enrichPriceFieldsWithDisplayTemplates(
    itemPriceCollection,
    itemGroupFieldPath,
    requestedFields,
  )

  const priceFilter = mergePriceFilters(
    options.priceGroupId,
    priceGroupField,
    options.filter,
  )

  const [groups, prices] = await Promise.all([
    bridgeReadItems(groupCollection, {
      fields: ['id', groupLabelField, groupParentField],
      sort: [groupLabelField],
      limit: -1,
    }),
    bridgeReadItems(itemPriceCollection, {
      fields: requestedFields,
      filter: priceFilter,
      limit: -1,
    }),
  ])

  return buildItemGroupPriceTree(groups, prices, {
    groupParentField,
    groupLabelField,
    itemGroupFieldPath,
  })
}

/**
 * Load group tree with nested prices (exact group match per node).
 * Uses BFF when config is fully resolved; otherwise bridge.
 */
export async function loadItemGroupPriceTree(
  options: LoadItemGroupPriceTreeOptions = {},
): Promise<ItemGroupPriceTreeResult> {
  let resolved = options
  if (!hasResolvedTreeConfig(resolved) && !resolved.groupCollection) {
    // Caller did not resolve — cannot invent collections; require explicit options
    // or prior resolveItemGroupPriceTreeOptionsFromContext.
    throw new Error(
      'loadItemGroupPriceTree requires options from resolveItemGroupPriceTreeOptionsFromContext.',
    )
  }

  if (hasResolvedTreeConfig(resolved)) {
    try {
      return await fetchItemGroupPriceTreeFromOptions(resolved)
    } catch {
      // Fall through to bridge if the BFF query is unavailable.
    }
  }
  return loadItemGroupPriceTreeViaBridge(resolved)
}

/**
 * Resolve scope record id for the price-list filter.
 * Prefer an explicit FK on the row; otherwise the document record id
 * (when the doc collection is the related "one" side of `priceGroupField`).
 */
export function resolveTreeScopeRecordId(
  recordId: string,
  record: Record<string, unknown>,
  priceGroupField: string,
): string | null {
  const field = priceGroupField.trim()
  if (field) {
    const fromField = record[field]
    if (typeof fromField === 'string' || typeof fromField === 'number') {
      const text = String(fromField).trim()
      if (text) return text
    }
    if (fromField && typeof fromField === 'object') {
      const nestedId = (fromField as Record<string, unknown>).id
      if (typeof nestedId === 'string' || typeof nestedId === 'number') {
        const text = String(nestedId).trim()
        if (text) return text
      }
    }
  }
  const id = recordId?.trim() || scalarId(record.id)
  return id || null
}
