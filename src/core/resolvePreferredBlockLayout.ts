import type { EntityLayoutSchema, RecordPageLayoutSchema } from '@/interfaces'
import {
  loadEntityLayoutById,
  resolveEntityLayoutForCurrentUser,
} from '@/modules/config/services/layoutSettings'
import { resolveRecordPageLayoutForCurrentUser } from '@/modules/config/services/recordPageSettings'

/**
 * Prefer the Page Layout "Default Block Layout" (and detail component refs)
 * over the role-scoped Block Layout pick used when no Page Layout is set.
 */
export async function resolvePreferredBlockLayoutForCurrentUser(
  collection: string,
): Promise<{
  blockLayout: EntityLayoutSchema | null
  pageLayout: RecordPageLayoutSchema | null
}> {
  const [pageLayout, fallbackBlockLayout] = await Promise.all([
    resolveRecordPageLayoutForCurrentUser(collection),
    resolveEntityLayoutForCurrentUser(collection),
  ])

  let blockLayout = fallbackBlockLayout

  try {
    if (pageLayout?.pageLayoutId) {
      const linked = await loadEntityLayoutById(collection, pageLayout.pageLayoutId)
      if (linked) blockLayout = linked
    } else if (pageLayout?.regions?.length) {
      const detailRef = pageLayout.regions
        .flatMap((region) => region.components ?? [])
        .find((component) => component.type === 'detail' && component.pageLayoutId)
      if (detailRef?.pageLayoutId) {
        const linked = await loadEntityLayoutById(collection, detailRef.pageLayoutId)
        if (linked) blockLayout = linked
      }
    }
  } catch {
    // Keep role-scoped fallback when Page Layout → Block Layout resolution fails.
  }

  return { blockLayout, pageLayout }
}
