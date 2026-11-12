import { findManyRecords } from '../adapters/records/facade.js'
import type { RecordAccess } from '../adapters/records/types.js'
import {
  fkIdFromValue,
  loadM2ORelations,
  loadO2MRelations,
} from '../adapters/records/relations.js'
import { query } from '../db/pool.js'
import { loadEntityMeta } from '../schema/entityMeta.js'

export interface ItemGroupPriceTreeNode {
  id: string
  name: string
  parent: string | null
  children: ItemGroupPriceTreeNode[]
  item_prices: Array<Record<string, unknown>>
}

export interface ItemGroupPriceTreeRow {
  group_id: string
  group_name: string
  group_path: string
  depth: number
  tree_index: number
  children: Array<Record<string, unknown>>
}

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

/** Caller-supplied tree wiring (from Tree Table settings + relations). */
export interface ItemGroupPriceTreeConfig {
  groupCollection: string
  itemPriceCollection: string
  groupParentField: string
  groupLabelField: string
  itemGroupFieldPath: string
  priceGroupField: string
}

export interface ItemGroupPriceTreeQueryArgs {
  priceGroupId?: string | null
  filter?: Record<string, unknown> | null
  fields?: string[] | null
  flatten?: boolean | null
  config?: ItemGroupPriceTreeConfig | Record<string, unknown> | null
  /** Verified caller — field-level security applies to both collections. */
  access: RecordAccess
}

interface HierarchyNode {
  key: string
  label: string
  data: Record<string, unknown>
  children: HierarchyNode[]
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseTreeConfig(
  raw: ItemGroupPriceTreeConfig | Record<string, unknown> | null | undefined,
): ItemGroupPriceTreeConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('itemGroupPriceTree requires a config object from Tree settings.')
  }
  const groupCollection = asTrimmedString(raw.groupCollection)
  const itemPriceCollection = asTrimmedString(raw.itemPriceCollection)
  const groupParentField = asTrimmedString(raw.groupParentField)
  const groupLabelField = asTrimmedString(raw.groupLabelField) || 'name'
  const itemGroupFieldPath = asTrimmedString(raw.itemGroupFieldPath)
  const priceGroupField = asTrimmedString(raw.priceGroupField)
  if (
    !groupCollection ||
    !itemPriceCollection ||
    !groupParentField ||
    !itemGroupFieldPath ||
    !priceGroupField
  ) {
    throw new Error(
      'itemGroupPriceTree config must include groupCollection, itemPriceCollection, groupParentField, itemGroupFieldPath, priceGroupField.',
    )
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

/**
 * When parent field is omitted, use the sole self-M2O on the group collection.
 * Never prefers a hard-coded API name.
 */
async function resolveSoleSelfParentField(groupCollection: string): Promise<string> {
  const m2o = await loadM2ORelations(groupCollection)
  const selfFks = m2o
    .filter((rel) => rel.relatedEntityApiName === groupCollection)
    .map((rel) => rel.fieldApiName.trim())
    .filter(Boolean)
  if (selfFks.length === 1) return selfFks[0]!
  if (selfFks.length === 0) {
    throw new Error(
      `No self-FK parent field found on "${groupCollection}". Pass config.groupParentField.`,
    )
  }
  throw new Error(
    `Multiple self-FK fields on "${groupCollection}" (${selfFks.join(', ')}). Pass config.groupParentField.`,
  )
}

function getPathValue(row: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, row)
}

function recordLabel(record: Record<string, unknown>, labelField: string): string {
  const value = record[labelField]
  if (value === null || value === undefined || value === '') {
    return String(fkIdFromValue(record.id) ?? '')
  }
  if (typeof value === 'object') {
    const nested = value as Record<string, unknown>
    return String(nested.name ?? nested.title ?? nested.label ?? nested.id ?? '')
  }
  return String(value)
}

function buildHierarchyTreeNodes(
  records: Array<Record<string, unknown>>,
  parentField: string,
  labelField: string,
): HierarchyNode[] {
  const nodeById = new Map<string, HierarchyNode>()
  const roots: HierarchyNode[] = []

  for (const record of records) {
    const id = fkIdFromValue(record.id)
    if (!id) continue
    nodeById.set(id, {
      key: id,
      label: recordLabel(record, labelField) || id,
      data: record,
      children: [],
    })
  }

  for (const node of nodeById.values()) {
    const parentId = readParentId(node.data, parentField)
    const parent = parentId ? nodeById.get(parentId) : null
    if (parent && parent.key !== node.key) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return sortHierarchyNodesByLabel(roots)
}

function readParentId(
  data: Record<string, unknown>,
  parentField: string,
): string | null {
  if (data[parentField] !== undefined) return fkIdFromValue(data[parentField])
  const lower = parentField.toLowerCase()
  for (const [key, value] of Object.entries(data)) {
    if (key.toLowerCase() === lower) return fkIdFromValue(value)
  }
  return null
}

/** Sibling order by label — matches CrmTreeTable sidebar. */
function sortHierarchyNodesByLabel(nodes: HierarchyNode[]): HierarchyNode[] {
  const sorted = [...nodes].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      sensitivity: 'base',
      numeric: true,
    }),
  )
  for (const node of sorted) {
    if (node.children.length) {
      node.children = sortHierarchyNodesByLabel(node.children)
    }
  }
  return sorted
}

function bucketItemPricesByGroupId(
  prices: Array<Record<string, unknown>>,
  itemGroupFieldPath: string,
): Map<string, Array<Record<string, unknown>>> {
  const byGroup = new Map<string, Array<Record<string, unknown>>>()
  for (const row of prices) {
    const groupId = fkIdFromValue(getPathValue(row, itemGroupFieldPath))
    if (!groupId) continue
    const list = byGroup.get(groupId)
    if (list) list.push(row)
    else byGroup.set(groupId, [row])
  }
  return byGroup
}

function attachItemPricesToGroupTree(
  nodes: HierarchyNode[],
  pricesByGroupId: Map<string, Array<Record<string, unknown>>>,
  parentField: string,
): ItemGroupPriceTreeNode[] {
  return nodes.map((node) => {
    const parentId = fkIdFromValue(node.data[parentField])
    return {
      id: node.key,
      name: node.label,
      parent: parentId,
      item_prices: pricesByGroupId.get(node.key) ?? [],
      children: attachItemPricesToGroupTree(node.children, pricesByGroupId, parentField),
    }
  })
}

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

function extractTemplateFields(template: string): string[] {
  const matcher = /\{\{\s*([\w.]+)\s*\}\}/g
  const fields: string[] = []
  let match = matcher.exec(template)
  while (match) {
    fields.push(match[1]!)
    match = matcher.exec(template)
  }
  return fields
}

async function listEntityFieldApiNames(entityApiName: string): Promise<string[]> {
  const rows = await query<{ api_name: string }>(
    `SELECT f.api_name
     FROM public.fields f
     INNER JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1
       AND e.deleted_at IS NULL
     ORDER BY f.api_name ASC`,
    [entityApiName],
  )
  return rows.map((row) => String(row.api_name))
}

/**
 * Load every price-line scalar + expand each M2O with Display Template fields
 * so nested `$item` / related records are full objects (not codes only).
 */
async function enrichPriceFieldsWithDisplayTemplates(
  itemPriceCollection: string,
  itemGroupFieldPath: string,
  fields: string[],
): Promise<string[]> {
  const next = new Set(fields)
  const [fieldNames, m2oRels, o2mRels] = await Promise.all([
    listEntityFieldApiNames(itemPriceCollection),
    loadM2ORelations(itemPriceCollection),
    loadO2MRelations(itemPriceCollection),
  ])
  const o2mAliases = new Set(
    o2mRels.map((rel) => rel.fieldApiName.toLowerCase()),
  )

  for (const name of fieldNames) {
    if (!name || o2mAliases.has(name.toLowerCase())) continue
    next.add(name)
  }

  for (const rel of m2oRels) {
    const name = rel.fieldApiName
    if (!name) continue
    next.add(name)
    next.add(`${name}.id`)
    const meta = await loadEntityMeta(rel.relatedEntityApiName)
    const tokens = meta?.displayTemplate
      ? extractTemplateFields(meta.displayTemplate)
      : ['name']
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

function buildItemGroupPriceTree(
  groups: Array<Record<string, unknown>>,
  prices: Array<Record<string, unknown>>,
  config: ItemGroupPriceTreeConfig,
): ItemGroupPriceTreeResult {
  const hierarchy = buildHierarchyTreeNodes(
    groups,
    config.groupParentField,
    config.groupLabelField,
  )
  const pricesByGroupId = bucketItemPricesByGroupId(
    prices,
    config.itemGroupFieldPath,
  )
  const tree = attachItemPricesToGroupTree(
    hierarchy,
    pricesByGroupId,
    config.groupParentField,
  )
  return {
    tree,
    rows: flattenItemGroupPriceTree(tree),
    sections: flattenItemGroupTreeSections(tree),
  }
}

/**
 * Load group hierarchy with prices nested under each group
 * (exact group-field match — descendants stay on child nodes).
 */
export async function loadItemGroupPriceTree(
  args: ItemGroupPriceTreeQueryArgs,
): Promise<ItemGroupPriceTreeResult> {
  if (!args.access) {
    throw new Error('loadItemGroupPriceTree requires access')
  }
  const access = args.access
  const config = parseTreeConfig(args.config)
  let parentField = config.groupParentField
  if (!parentField) {
    parentField = await resolveSoleSelfParentField(config.groupCollection)
  }
  const resolved: ItemGroupPriceTreeConfig = {
    ...config,
    groupParentField: parentField,
  }

  let requestedFields = args.fields?.length ? [...args.fields] : ['id']
  if (!requestedFields.includes(resolved.itemGroupFieldPath)) {
    requestedFields.push(resolved.itemGroupFieldPath)
  }
  if (
    resolved.priceGroupField &&
    !requestedFields.includes(resolved.priceGroupField)
  ) {
    requestedFields.push(resolved.priceGroupField)
  }
  if (!requestedFields.includes('id')) {
    requestedFields.unshift('id')
  }
  requestedFields = await enrichPriceFieldsWithDisplayTemplates(
    resolved.itemPriceCollection,
    resolved.itemGroupFieldPath,
    requestedFields,
  )

  const priceFilter = mergePriceFilters(
    args.priceGroupId,
    resolved.priceGroupField,
    args.filter ?? null,
  )

  const [groupsResult, pricesResult] = await Promise.all([
    findManyRecords(resolved.groupCollection, {
      fields: ['id', resolved.groupLabelField, resolved.groupParentField],
      sort: [resolved.groupLabelField],
      limit: -1,
      access,
    }),
    findManyRecords(resolved.itemPriceCollection, {
      fields: requestedFields,
      filter: priceFilter,
      limit: -1,
      access,
    }),
  ])

  return buildItemGroupPriceTree(
    groupsResult.nodes,
    pricesResult.nodes,
    resolved,
  )
}
