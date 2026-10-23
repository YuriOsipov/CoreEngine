import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { DataTableSettings, DataTableSortConfig } from '@/interfaces'
import type { DataTableRuntime } from '../services/dataTableRuntime'

export interface DataTableSortChangePayload {
  field: string | null
  order: 1 | -1 | null
  sortKey: string | null
}

export interface DataTableLoadMorePayload {
  offset: number
  limit: number
}

export interface UseDataTableLazyOptions {
  settings: Ref<DataTableSettings | null> | ComputedRef<DataTableSettings | null>
  fetchFn: (params: {
    limit: number
    offset: number
    settings: DataTableSettings
  }) => Promise<DataTableRuntime>
  disableSort?: Ref<boolean> | ComputedRef<boolean>
  disableGroupBy?: Ref<boolean> | ComputedRef<boolean>
  initialPageSize?: number
  loadErrorMessage?: string
  loadMoreErrorMessage?: string
}

export function useDataTableLazy(options: UseDataTableLazyOptions) {
  const runtime = ref<DataTableRuntime | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const refreshing = ref(false)
  const error = ref<string | null>(null)
  const pageSize = ref(options.initialPageSize ?? 25)
  const activeSort = ref<DataTableSortConfig | null>(null)
  let loadToken = 0

  const tableDefaultSortField = computed(() =>
    options.disableSort?.value ? null : options.settings.value?.sort?.field ?? null,
  )
  const tableDefaultSortOrder = computed<1 | -1 | null>(() =>
    options.disableSort?.value ? null : options.settings.value?.sort?.order ?? null,
  )
  const tableGroupBy = computed(() =>
    options.disableGroupBy?.value ? null : options.settings.value?.groupBy ?? null,
  )
  const defaultSortField = computed(() =>
    activeSort.value?.field ?? tableDefaultSortField.value,
  )
  const defaultSortOrder = computed<1 | -1 | null>(() =>
    activeSort.value?.order ?? tableDefaultSortOrder.value,
  )
  const hasMore = computed(
    () => (runtime.value?.rows.length ?? 0) < (runtime.value?.totalCount ?? 0),
  )

  const crmDataTableProps = computed(() => ({
    rows: runtime.value?.rows ?? [],
    columns: runtime.value?.columns ?? [],
    lazy: true as const,
    allowRowGrouping: true as const,
    hasMore: hasMore.value,
    loadingMore: loadingMore.value,
    totalRecords: runtime.value?.totalCount ?? 0,
    defaultSortField: defaultSortField.value,
    defaultSortOrder: defaultSortOrder.value,
    groupBy: tableGroupBy.value,
    recordLinkField: options.settings.value?.recordLinkField ?? null,
  }))

  function resolveFetchSettings(): DataTableSettings {
    const base = options.settings.value ?? { columns: [] }
    if (activeSort.value) {
      return { ...base, sort: activeSort.value }
    }
    if (options.disableSort?.value) {
      return { ...base, sort: null }
    }
    return base
  }

  async function reload(inPlace = false): Promise<void> {
    const token = ++loadToken
    if (inPlace && runtime.value) {
      refreshing.value = true
    } else {
      loading.value = true
      runtime.value = null
    }
    error.value = null

    try {
      const settings = resolveFetchSettings()
      const result = await options.fetchFn({
        limit: pageSize.value,
        offset: 0,
        settings,
      })
      if (token !== loadToken) return
      runtime.value = result
    } catch (err) {
      if (token !== loadToken) return
      error.value =
        err instanceof Error
          ? err.message
          : (options.loadErrorMessage ?? 'Failed to load records.')
    } finally {
      if (token === loadToken) {
        loading.value = false
        refreshing.value = false
      }
    }
  }

  async function loadMore(payload: DataTableLoadMorePayload): Promise<void> {
    if (!runtime.value || loadingMore.value) return
    if (runtime.value.rows.length >= runtime.value.totalCount) return

    const token = loadToken
    const offset = runtime.value.rows.length
    loadingMore.value = true
    error.value = null

    try {
      const settings = resolveFetchSettings()
      if (!settings) return

      const result = await options.fetchFn({
        limit: payload.limit,
        offset,
        settings,
      })
      if (token !== loadToken || !runtime.value) return

      runtime.value = {
        ...runtime.value,
        rows: [...runtime.value.rows, ...result.rows],
        totalCount: result.totalCount,
      }
    } catch (err) {
      if (token !== loadToken) return
      error.value =
        err instanceof Error
          ? err.message
          : (options.loadMoreErrorMessage ?? 'Failed to load more records.')
    } finally {
      if (token === loadToken) {
        loadingMore.value = false
      }
    }
  }

  function handlePageSizeChange(nextPageSize: number): void {
    if (nextPageSize === pageSize.value) return
    pageSize.value = nextPageSize
    if (!runtime.value) return

    const loadedCount = runtime.value.rows.length
    const missingCount = nextPageSize - loadedCount
    if (missingCount <= 0 || loadedCount >= runtime.value.totalCount) return

    void loadMore({
      offset: loadedCount,
      limit: missingCount,
    })
  }

  function handleSortChange(payload: DataTableSortChangePayload): void {
    const order =
      payload.order === 1 || payload.order === -1 ? payload.order : null
    const sortKey = payload.sortKey?.trim() || payload.field?.trim() || null
    activeSort.value =
      sortKey && order ? { field: sortKey, order } : null
    void reload(true)
  }

  function resetSort(): void {
    activeSort.value = null
  }

  function syncSortFromSettings(settings: DataTableSettings | null): void {
    activeSort.value = settings?.sort ?? null
  }

  function updateRows(rows: Record<string, unknown>[]): void {
    if (!runtime.value) return
    runtime.value = {
      ...runtime.value,
      rows,
    }
  }

  function isStaleToken(token: number): boolean {
    return token !== loadToken
  }

  function nextLoadToken(): number {
    return ++loadToken
  }

  function currentLoadToken(): number {
    return loadToken
  }

  return {
    runtime,
    loading,
    loadingMore,
    refreshing,
    error,
    pageSize,
    activeSort,
    tableDefaultSortField,
    tableDefaultSortOrder,
    tableGroupBy,
    defaultSortField,
    defaultSortOrder,
    hasMore,
    crmDataTableProps,
    reload,
    loadMore,
    handlePageSizeChange,
    handleSortChange,
    resetSort,
    syncSortFromSettings,
    updateRows,
    isStaleToken,
    nextLoadToken,
    currentLoadToken,
  }
}
