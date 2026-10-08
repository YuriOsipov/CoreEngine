import { bridgeCreateItem, bridgeUpdateItem } from '@/core/graphql/itemsBridge'
import { PM_STAGE_COLLECTION } from '@/interfaces/projects'

/**
 * Low-level create without layout-driven clone hooks.
 * Used by createObjectRecord and by cloneRelatedFrom to avoid circular imports.
 */
export async function writeCreateItem(
  collection: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let next = payload
  if (collection === PM_STAGE_COLLECTION) {
    const { initializeTaskSchedule } = await import(
      '@/modules/projects/services/pmProjectService'
    )
    next = await initializeTaskSchedule(payload)
  }
  return bridgeCreateItem(collection, next)
}

export async function writeUpdateItem(
  collection: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return bridgeUpdateItem(collection, id, payload)
}
