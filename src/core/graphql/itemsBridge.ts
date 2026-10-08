import {
  canUseRecordsGraphQL,
  createRecordViaGraphQL,
  deleteRecordViaGraphQL,
  fetchRecordFromGraphQL,
  fetchRecordsFromGraphQL,
  restoreRecordViaGraphQL,
  softDeleteRecordViaGraphQL,
  updateRecordViaGraphQL,
} from '@/core/graphql/recordsApi'
import { refuseLegacyFallback } from '@/core/graphql/featureFlags'

export interface ItemsBridgeListParams {
  filter?: Record<string, unknown> | null
  fields?: string[] | null
  sort?: string[] | null
  search?: string | null
  limit?: number
  offset?: number
  includeDeleted?: boolean
}

export interface ItemsBridgePage {
  nodes: Record<string, unknown>[]
  totalCount: number
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function asFilter(value: unknown): Record<string, unknown> | null | undefined {
  if (value == null) return value as null | undefined
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function graphqlLimit(value: number | undefined): number {
  if (value === undefined) return 50
  if (value < 0) return 10_000
  return value
}

function listParamsFromUnknown(params: Record<string, unknown>): ItemsBridgeListParams {
  return {
    filter: asFilter(params.filter) ?? null,
    fields: asStringArray(params.fields) ?? null,
    sort: asStringArray(params.sort) ?? null,
    search: typeof params.search === 'string' ? params.search : null,
    limit: typeof params.limit === 'number' ? params.limit : undefined,
    offset: typeof params.offset === 'number' ? params.offset : 0,
    includeDeleted:
      typeof params.includeDeleted === 'boolean' ? params.includeDeleted : undefined,
  }
}

function requireRecordsGraphQL(purpose: string): void {
  if (!canUseRecordsGraphQL()) {
    refuseLegacyFallback(purpose)
  }
}

export async function bridgeReadItems(
  collection: string,
  params: ItemsBridgeListParams | Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const page = await bridgeReadItemsPage(collection, params)
  return page.nodes
}

/**
 * List + totalCount in one place. GraphQL uses a single records query (meta count).
 * Legacy SDK fallback removed — set VITE_RECORDS_SOURCE=graphql.
 */
export async function bridgeReadItemsPage(
  collection: string,
  params: ItemsBridgeListParams | Record<string, unknown> = {},
  options: { includeTotalCount?: boolean } = {},
): Promise<ItemsBridgePage> {
  requireRecordsGraphQL(`bridgeReadItemsPage(${collection})`)
  const normalized = listParamsFromUnknown(params as Record<string, unknown>)
  const includeTotalCount = options.includeTotalCount !== false

  const page = await fetchRecordsFromGraphQL({
    entity: collection,
    filter: normalized.filter ?? null,
    fields: normalized.fields ?? undefined,
    sort: normalized.sort ?? undefined,
    search: normalized.search ?? undefined,
    limit: graphqlLimit(normalized.limit),
    offset: normalized.offset ?? 0,
    includeDeleted: normalized.includeDeleted,
  })
  return {
    nodes: page.nodes,
    totalCount: includeTotalCount ? page.totalCount : page.nodes.length,
  }
}

export async function bridgeReadItem(
  collection: string,
  id: string | number,
  options: { fields?: string[] | null } = {},
): Promise<Record<string, unknown>> {
  requireRecordsGraphQL(`bridgeReadItem(${collection},${id})`)
  return fetchRecordFromGraphQL(collection, String(id), options.fields ?? undefined)
}

export async function bridgeCreateItem(
  collection: string,
  payload: Record<string, unknown>,
  options: { fields?: string[] | null } = {},
): Promise<Record<string, unknown>> {
  requireRecordsGraphQL(`bridgeCreateItem(${collection})`)
  return createRecordViaGraphQL(collection, payload, options.fields)
}

export async function bridgeUpdateItem(
  collection: string,
  id: string | number,
  payload: Record<string, unknown>,
  options: { fields?: string[] | null } = {},
): Promise<Record<string, unknown>> {
  requireRecordsGraphQL(`bridgeUpdateItem(${collection},${id})`)
  return updateRecordViaGraphQL(collection, String(id), payload, options.fields)
}

export async function bridgeCreateItems(
  collection: string,
  payloads: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (payloads.length === 0) return []
  requireRecordsGraphQL(`bridgeCreateItems(${collection})`)
  const created: Record<string, unknown>[] = []
  for (const payload of payloads) {
    created.push(await createRecordViaGraphQL(collection, payload))
  }
  return created
}

export async function bridgeDeleteItem(
  collection: string,
  id: string | number,
): Promise<void> {
  requireRecordsGraphQL(`bridgeDeleteItem(${collection},${id})`)
  await deleteRecordViaGraphQL(collection, String(id))
}

export async function bridgeSoftDeleteItem(
  collection: string,
  id: string | number,
): Promise<void> {
  requireRecordsGraphQL(`bridgeSoftDeleteItem(${collection},${id})`)
  await softDeleteRecordViaGraphQL(collection, String(id))
}

export async function bridgeRestoreItem(
  collection: string,
  id: string | number,
): Promise<Record<string, unknown>> {
  requireRecordsGraphQL(`bridgeRestoreItem(${collection},${id})`)
  return restoreRecordViaGraphQL(collection, String(id))
}
