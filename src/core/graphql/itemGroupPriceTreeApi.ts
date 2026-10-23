import { graphqlRequest } from './client'
import {
  flattenItemGroupTreeSections,
  toItemGroupPriceTreeConfig,
  type ItemGroupPriceTreeConfig,
  type ItemGroupPriceTreeResult,
  type LoadItemGroupPriceTreeOptions,
} from '@/core/itemGroupPriceTree'

const ITEM_GROUP_PRICE_TREE_QUERY = /* GraphQL */ `
  query ItemGroupPriceTree(
    $priceGroupId: ID
    $filter: JSON
    $fields: [String!]
    $flatten: Boolean
    $config: JSON
  ) {
    itemGroupPriceTree(
      priceGroupId: $priceGroupId
      filter: $filter
      fields: $fields
      flatten: $flatten
      config: $config
    )
  }
`

export interface FetchItemGroupPriceTreeParams {
  priceGroupId?: string | null
  filter?: Record<string, unknown> | null
  fields?: string[] | null
  /** When false, BFF returns rows: []. Default true. */
  flatten?: boolean
  config?: ItemGroupPriceTreeConfig | null
}

/**
 * Single-round-trip export of group hierarchy → nested item prices
 * via BFF `itemGroupPriceTree`.
 */
export async function fetchItemGroupPriceTree(
  params: FetchItemGroupPriceTreeParams = {},
): Promise<ItemGroupPriceTreeResult> {
  const data = await graphqlRequest<{ itemGroupPriceTree: ItemGroupPriceTreeResult }>(
    ITEM_GROUP_PRICE_TREE_QUERY,
    {
      priceGroupId: params.priceGroupId ?? null,
      filter: params.filter ?? null,
      fields: params.fields ?? null,
      flatten: params.flatten !== false,
      config: params.config ?? null,
    },
  )
  const payload = data.itemGroupPriceTree
  const tree = Array.isArray(payload?.tree) ? payload.tree : []
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  const sections = Array.isArray(payload?.sections)
    ? payload.sections
    : flattenItemGroupTreeSections(tree)
  return { tree, rows, sections }
}

/** Maps core loader options onto the GraphQL export query. */
export async function fetchItemGroupPriceTreeFromOptions(
  options: LoadItemGroupPriceTreeOptions = {},
): Promise<ItemGroupPriceTreeResult> {
  const config = toItemGroupPriceTreeConfig(options)
  if (!config) {
    throw new Error('itemGroupPriceTree requires a fully resolved config.')
  }
  return fetchItemGroupPriceTree({
    priceGroupId: options.priceGroupId,
    filter: options.filter,
    fields: options.fields,
    flatten: true,
    config,
  })
}
