import {
  bridgeCreateItem,
  bridgeReadItems,
} from '@/core/graphql/itemsBridge'

export async function readRelatedTransferItems(
  collection: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  return bridgeReadItems(collection, params)
}

export async function createRelatedTransferItem(
  collection: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return bridgeCreateItem(collection, payload)
}
