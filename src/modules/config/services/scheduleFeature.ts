import {
  SCHEDULE_SLOT_COLLECTION,
  SCHEDULE_TEMPLATE_COLLECTION,
} from '@/core/scheduleConstants'
import { collectionExistsInRegistry } from '@/modules/entities/services/collectionSchema'

/** True when schedule template + slot collections are registered. */
export async function scheduleFeatureAvailable(): Promise<boolean> {
  const [templateExists, slotExists] = await Promise.all([
    collectionExistsInRegistry(SCHEDULE_TEMPLATE_COLLECTION),
    collectionExistsInRegistry(SCHEDULE_SLOT_COLLECTION),
  ])
  return templateExists && slotExists
}
