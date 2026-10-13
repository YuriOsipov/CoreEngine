import { computed, ref, watch, type Ref } from 'vue'
import type { EntityLayoutSchema, RelationDefinition } from '@/interfaces'
import { bridgeReadItem } from '@/core/graphql/itemsBridge'
import {
  collectShowIfFieldPaths,
  showIfRequestFields,
} from '@/core/recordConditionMatch'
import { relatedCollectionForCollectionField } from '@/core/relationHelpers'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'
import { getCachedRelations } from '@/modules/entities/services/collectionSchema'

type RelatedCacheEntry = {
  id: string
  record: Record<string, unknown>
}

/**
 * Builds a record suitable for tab show-if evaluation when form state stores
 * M2O fields as scalar ids. Nested paths (e.g. `item.result_type`) are hydrated
 * from related collections on demand.
 */
export function useShowIfEvalRecord(
  schema: Ref<EntityLayoutSchema> | (() => EntityLayoutSchema),
  formState: Ref<Record<string, unknown>>,
) {
  const relatedCache = ref<Record<string, RelatedCacheEntry>>({})
  const relations = ref<RelationDefinition[]>([])

  const resolveSchema = () =>
    typeof schema === 'function' ? schema() : schema.value

  const nestedShowIfRoots = computed(() => {
    const roots = new Map<string, string[]>()
    for (const path of collectShowIfFieldPaths(resolveSchema().sections)) {
      const parts = path.split('.').filter(Boolean)
      if (parts.length < 2) continue
      const root = parts[0]
      const nested = parts.slice(1).join('.')
      const list = roots.get(root) ?? []
      if (!list.includes(nested)) list.push(nested)
      roots.set(root, list)
    }
    return roots
  })

  async function ensureRelations(): Promise<RelationDefinition[]> {
    if (relations.value.length > 0) return relations.value
    relations.value = (await getCachedRelations()) as RelationDefinition[]
    return relations.value
  }

  async function hydrateRelated(): Promise<void> {
    const roots = nestedShowIfRoots.value
    if (roots.size === 0) {
      relatedCache.value = {}
      return
    }

    const collection = resolveSchema().entity
    const rels = await ensureRelations()
    const nextCache: Record<string, RelatedCacheEntry> = { ...relatedCache.value }
    const tasks: Promise<void>[] = []

    for (const [root, nestedFields] of roots) {
      const current = formState.value[root]
      const id = extractRelationFieldId(current)
      if (id == null || id === '') {
        delete nextCache[root]
        continue
      }
      const idKey = String(id)
      const cached = nextCache[root]
      if (cached && cached.id === idKey) {
        if (current && typeof current === 'object' && !Array.isArray(current)) {
          nextCache[root] = {
            id: idKey,
            record: {
              ...cached.record,
              ...(current as Record<string, unknown>),
              id: (current as Record<string, unknown>).id ?? cached.record.id ?? id,
            },
          }
        }
        continue
      }

      const relatedCollection = relatedCollectionForCollectionField(
        rels,
        collection,
        root,
      )
      if (!relatedCollection) {
        delete nextCache[root]
        continue
      }

      const requestFields = showIfRequestFields(
        nestedFields.map((nested) => `${root}.${nested}`),
      ).map((path) => {
        const parts = path.split('.')
        return parts.length > 1 ? parts.slice(1).join('.') : path
      })

      tasks.push(
        (async () => {
          try {
            const record = await bridgeReadItem(relatedCollection, id, {
              fields: Array.from(new Set(['id', ...requestFields])),
            })
            nextCache[root] = { id: idKey, record }
          } catch {
            delete nextCache[root]
          }
        })(),
      )
    }

    if (tasks.length > 0) {
      await Promise.all(tasks)
    }
    relatedCache.value = nextCache
  }

  watch(
    [() => resolveSchema().entity, () => resolveSchema().sections, formState, nestedShowIfRoots],
    () => {
      void hydrateRelated()
    },
    { immediate: true, deep: true },
  )

  const evalRecord = computed(() => {
    const base: Record<string, unknown> = { ...formState.value }
    for (const [root, entry] of Object.entries(relatedCache.value)) {
      const current = base[root]
      const id = extractRelationFieldId(current)
      if (id == null || String(id) !== entry.id) continue
      base[root] = {
        ...entry.record,
        ...(current && typeof current === 'object' && !Array.isArray(current)
          ? (current as Record<string, unknown>)
          : { id }),
      }
    }
    return base
  })

  return { evalRecord }
}
