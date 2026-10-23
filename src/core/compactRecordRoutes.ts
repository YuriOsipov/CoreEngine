import type { RouteLocationRaw, Router } from 'vue-router'
import { rowRecordId } from '@/modules/entities/utils/recordDisplay'
import type { CompactRecordDetailsRuntime } from '@/modules/entities/services/recordDetails'
import { PM_PROJECT_COLLECTION } from '@/interfaces/projects'

export function recordDetailRoute(
  collection: string,
  id: string | number,
): RouteLocationRaw {
  if (collection === PM_PROJECT_COLLECTION) {
    return {
      name: 'project-workspace',
      params: { projectId: String(id) },
      query: { view: 'gantt' },
    }
  }
  return {
    name: 'record-details',
    params: {
      collection,
      id: String(id),
    },
  }
}

export function projectRecordFormRoute(id: string | number): RouteLocationRaw {
  return {
    name: 'record-details',
    params: {
      collection: PM_PROJECT_COLLECTION,
      id: String(id),
    },
    query: { form: '1' },
  }
}

export function childRecordDetailRoute(
  parentCollection: string,
  parentId: string | number,
  childCollection: string,
  childId: string | number,
): RouteLocationRaw {
  return {
    name: 'related-record-details',
    params: {
      collection: parentCollection,
      id: String(parentId),
      related_collection: childCollection,
      related_id: String(childId),
    },
  }
}

export function compactRelatedListRoute(
  collection: string,
  id: string | number,
  relatedCollection: string,
): RouteLocationRaw {
  return {
    name: 'related-record-list',
    params: {
      collection,
      id: String(id),
      related_collection: relatedCollection,
    },
  }
}

export function recordActivityLogRoute(
  collection: string,
  id: string | number,
): RouteLocationRaw {
  return {
    name: 'record-activity-log',
    params: {
      collection,
      id: String(id),
    },
  }
}

export function compactRelatedListHref(
  collection: string,
  id: string | number,
  relatedCollection: string,
): string {
  return [
    '',
    'object',
    encodeURIComponent(collection),
    encodeURIComponent(String(id)),
    encodeURIComponent(relatedCollection),
  ].join('/')
}

export function tooltipRelatedListRoute(
  runtime: CompactRecordDetailsRuntime | null | undefined,
  relatedCollection: string,
): RouteLocationRaw {
  if (!runtime?.collection || runtime.id === null || runtime.id === undefined) {
    return { name: 'home' }
  }
  return compactRelatedListRoute(runtime.collection, runtime.id, relatedCollection)
}

export function fieldRelatedRecordRoute(
  field: { relatedCollection?: string | null },
  value: string | number | null,
): RouteLocationRaw {
  if (!field.relatedCollection || value === null) return { name: 'home' }
  return recordDetailRoute(field.relatedCollection, value)
}

export function openRecordInNewTab(
  router: Router,
  field: { relatedCollection?: string | null },
  row: Record<string, unknown>,
): void {
  if (!field.relatedCollection) return
  const rowId = rowRecordId(row)
  if (!rowId) return
  const route = router.resolve(recordDetailRoute(field.relatedCollection, rowId))
  window.open(route.href, '_blank', 'noopener')
}
