import { computed, ref, watch, type MaybeRefOrGetter, toValue } from 'vue'
import type { LayoutFieldMetadata } from '@/interfaces'
import { resolveConfiguredRowLimit } from '@/modules/entities/services/tableSettings'
import {
  appendM2ABlockRow,
  collectionDisplayLabel,
  fetchM2AMetadata,
  filterVisibleM2ABlocks,
  hydrateM2AItems,
  linkedM2AItemIds,
  loadM2AJunctionRows,
  normalizeM2ARows,
  persistM2AJunctionRows,
  serializeM2AEditorRows,
  summarizeM2AItem,
  type M2AJunctionRow,
  type M2AMetadata,
} from '@/modules/entities/utils/m2aSchema'
import { getCachedCollections } from '@/modules/entities/services/collectionSchema'
import type { CollectionDefinition } from '@/interfaces'
import { keysEqual } from '@/core/relationHelpers'
import { humanizeFieldName } from '@/modules/entities/utils/recordDisplay'
import {
  canCreateEntity,
  ensureEntityPermissions,
} from '@/core/entityPermissions'

export interface UseM2ABlocksFieldOptions {
  field: MaybeRefOrGetter<LayoutFieldMetadata>
  entity: MaybeRefOrGetter<string>
  parentId: MaybeRefOrGetter<string | number | undefined>
  modelValue: MaybeRefOrGetter<unknown>
  originalValue: MaybeRefOrGetter<unknown>
  editable: MaybeRefOrGetter<boolean>
}

export function useM2ABlocksField(options: UseM2ABlocksFieldOptions) {
  const metadata = ref<M2AMetadata | null>(null)
  const localRows = ref<M2AJunctionRow[]>([])
  const collectionLabels = ref<Record<string, string>>({})
  const collectionDefinitions = ref<Record<string, CollectionDefinition | null>>({})
  const loading = ref(false)
  const rowsHydrating = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const lastEmittedRowsSignature = ref<string | null>(null)
  const savedBaselineRows = ref<M2AJunctionRow[]>([])
  const junctionLoadToken = ref(0)

  const isReady = computed(() => !loading.value && !rowsHydrating.value)
  const rowLimit = computed(() =>
    resolveConfiguredRowLimit(toValue(options.field).m2a?.rowLimit),
  )

  const displayRows = computed(() => {
    if (toValue(options.editable)) return localRows.value
    return filterVisibleM2ABlocks(localRows.value)
  })

  const totalCount = computed(() => displayRows.value.length)
  const hasMore = computed(() => totalCount.value > rowLimit.value)
  const visibleRows = computed(() => displayRows.value.slice(0, rowLimit.value))

  const pendingCreateCollection = ref<string | null>(null)
  const createDialogVisible = ref(false)
  const pendingLinkCollection = ref<string | null>(null)
  const linkDialogVisible = ref(false)
  const viewAllVisible = ref(false)
  const permissionsReady = ref(false)

  const effectiveAllowedCollections = computed(() => {
    const fromMetadata = metadata.value?.allowedCollections ?? []
    if (fromMetadata.length > 0) return fromMetadata

    const fromLayout =
      toValue(options.field).m2a?.blockFields
        ?.map((entry) => entry.collection)
        .filter(Boolean) ?? []
    if (fromLayout.length > 0) return Array.from(new Set(fromLayout))

    return Array.from(
      new Set(localRows.value.map((row) => row.collection).filter(Boolean)),
    )
  })

  watch(
    effectiveAllowedCollections,
    () => {
      void ensureEntityPermissions().then(() => {
        permissionsReady.value = true
      })
    },
    { immediate: true },
  )

  const createMenuItems = computed(() => {
    void permissionsReady.value
    return effectiveAllowedCollections.value
      .filter((collection) => canCreateEntity(collection))
      .map((collection) => ({
        label: collectionLabels.value[collection] ??
          humanizeFieldName(collection.replace(/^block_/, '')),
        command: () => {
          pendingCreateCollection.value = collection
          createDialogVisible.value = true
        },
      }))
  })

  const linkMenuItems = computed(() =>
    effectiveAllowedCollections.value.map((collection) => ({
      label: collectionLabels.value[collection] ??
        humanizeFieldName(collection.replace(/^block_/, '')),
      command: () => {
        pendingLinkCollection.value = collection
        linkDialogVisible.value = true
      },
    })),
  )

  async function preloadCollectionLabels(collections: string[]): Promise<void> {
    const unique = Array.from(new Set(collections.filter(Boolean)))
    if (unique.length === 0) return

    const definitions = (await getCachedCollections()) as CollectionDefinition[]
    const nextLabels = { ...collectionLabels.value }
    const nextDefinitions = { ...collectionDefinitions.value }

    await Promise.all(
      unique.map(async (collection) => {
        if (nextLabels[collection]) return
        nextLabels[collection] = await collectionDisplayLabel(collection)
        nextDefinitions[collection] =
          definitions.find((item) => keysEqual(item.collection, collection)) ?? null
      }),
    )

    collectionLabels.value = nextLabels
    collectionDefinitions.value = nextDefinitions
  }

  async function applyRows(rows: M2AJunctionRow[], markBaseline: boolean): Promise<void> {
    const sorted = rows.map((row, index) => ({ ...row, sort: row.sort ?? index }))
    localRows.value = sorted
    lastEmittedRowsSignature.value = serializeM2AEditorRows(sorted)
    if (markBaseline) {
      savedBaselineRows.value = sorted.map((row) => ({ ...row }))
    }
    await preloadCollectionLabels(sorted.map((row) => row.collection))
  }

  async function reloadFromJunction(): Promise<void> {
    const meta = metadata.value
    const parentId = toValue(options.parentId)
    if (!meta || parentId === undefined || parentId === null || parentId === '') {
      return
    }
    const token = ++junctionLoadToken.value
    rowsHydrating.value = true
    error.value = null
    try {
      const rows = await loadM2AJunctionRows(meta, parentId)
      if (token !== junctionLoadToken.value) return
      await applyRows(rows, true)
    } catch (err) {
      if (token !== junctionLoadToken.value) return
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (token === junctionLoadToken.value) {
        rowsHydrating.value = false
      }
    }
  }

  watch(
    () => [toValue(options.entity), toValue(options.field).field] as const,
    async ([entity, fieldName]) => {
      if (!entity || !fieldName) {
        metadata.value = null
        return
      }
      loading.value = true
      error.value = null
      try {
        metadata.value = await fetchM2AMetadata(entity, fieldName)
        const collections =
          metadata.value?.allowedCollections?.length
            ? metadata.value.allowedCollections
            : localRows.value.map((row) => row.collection)
        await preloadCollectionLabels(collections)
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err)
      } finally {
        loading.value = false
      }
    },
    { immediate: true },
  )

  // Junction list is the source of truth when the parent record exists.
  watch(
    () =>
      [
        metadata.value,
        toValue(options.parentId),
      ] as const,
    async ([meta, parentId]) => {
      if (!meta) return
      if (parentId === undefined || parentId === null || parentId === '') {
        // New parent: fall back to in-memory model value only.
        const value = toValue(options.modelValue)
        rowsHydrating.value = true
        try {
          const normalized = normalizeM2ARows(value, meta)
          await applyRows(await hydrateM2AItems(normalized), true)
        } finally {
          rowsHydrating.value = false
        }
        return
      }
      await reloadFromJunction()
    },
    { immediate: true },
  )

  watch(
    localRows,
    (rows) => {
      void preloadCollectionLabels(rows.map((row) => row.collection))
    },
    { deep: true },
  )

  function rowSummary(row: M2AJunctionRow): string {
    const definition = collectionDefinitions.value[row.collection] ?? null
    const preferredFields =
      toValue(options.field).m2a?.blockFields?.find((entry) =>
        keysEqual(entry.collection, row.collection),
      )?.fields ?? null
    const summary = summarizeM2AItem(row.item, definition, preferredFields)
    const typeLabel =
      collectionLabels.value[row.collection] ??
      humanizeFieldName(row.collection.replace(/^block_/, ''))
    if (!summary || summary === typeLabel) return typeLabel
    return `${typeLabel}: ${summary}`
  }

  function rowTypeLabel(row: M2AJunctionRow): string {
    return (
      collectionLabels.value[row.collection] ??
      humanizeFieldName(row.collection.replace(/^block_/, ''))
    )
  }

  async function persistRows(nextRows: M2AJunctionRow[]): Promise<void> {
    const parentId = toValue(options.parentId)
    const meta = metadata.value
    if (!meta) return

    const sorted = nextRows.map((row, index) => ({ ...row, sort: index }))

    // Stage mode (new parent): keep rows in memory; parent create nests them.
    if (parentId === undefined || parentId === null || parentId === '') {
      await applyRows(sorted, true)
      return
    }

    if (saving.value) return
    saving.value = true
    error.value = null
    try {
      const persisted = await persistM2AJunctionRows(
        meta,
        parentId,
        sorted,
        savedBaselineRows.value,
      )
      await applyRows(persisted, true)
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      saving.value = false
    }
  }

  async function reorderRows(nextRows: M2AJunctionRow[]): Promise<void> {
    await persistRows(nextRows)
  }

  async function removeRow(index: number): Promise<void> {
    const next = localRows.value.filter((_, rowIndex) => rowIndex !== index)
    await persistRows(next)
  }

  async function appendCreatedBlock(
    collection: string,
    itemId: string | number,
  ): Promise<boolean> {
    const next = appendM2ABlockRow(localRows.value, collection, itemId)
    if (next === localRows.value) return false
    await persistRows(next)
    return true
  }

  async function toggleHideRow(index: number): Promise<void> {
    const row = localRows.value[index]
    if (!row) return
    const next = localRows.value.map((entry, rowIndex) =>
      rowIndex === index
        ? { ...entry, hideBlock: entry.hideBlock !== true }
        : entry,
    )
    await persistRows(next)
  }

  function linkedIdsForCollection(collection: string): Array<string | number> {
    return linkedM2AItemIds(localRows.value, collection)
  }

  function closeCreateDialog(): void {
    createDialogVisible.value = false
    pendingCreateCollection.value = null
  }

  function closeLinkDialog(): void {
    linkDialogVisible.value = false
    pendingLinkCollection.value = null
  }

  return {
    metadata,
    localRows,
    collectionLabels,
    loading,
    rowsHydrating,
    saving,
    error,
    isReady,
    rowLimit,
    displayRows,
    totalCount,
    hasMore,
    visibleRows,
    createMenuItems,
    linkMenuItems,
    pendingCreateCollection,
    createDialogVisible,
    pendingLinkCollection,
    linkDialogVisible,
    viewAllVisible,
    rowSummary,
    rowTypeLabel,
    reorderRows,
    removeRow,
    appendCreatedBlock,
    toggleHideRow,
    linkedIdsForCollection,
    closeCreateDialog,
    closeLinkDialog,
  }
}
