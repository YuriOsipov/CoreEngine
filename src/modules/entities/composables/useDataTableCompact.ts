import { computed, ref, watch, type MaybeRefOrGetter, toValue, type Ref } from 'vue'
import type { DataTableRuntime } from '../services/dataTableRuntime'

export interface UseDataTableCompactOptions {
  fetchFn: () => Promise<DataTableRuntime>
  watchKey: Ref<string>
  maxRows?: MaybeRefOrGetter<number>
  enabled?: MaybeRefOrGetter<boolean>
}

export function useDataTableCompact(options: UseDataTableCompactOptions) {
  const runtime = ref<DataTableRuntime | null>(null)
  const loading = ref(false)
  let loadToken = 0
  let requestKey = ''

  const resolvedMaxRows = computed(() => toValue(options.maxRows) ?? 5)
  const isEnabled = computed(() => toValue(options.enabled) !== false)

  const hasMore = computed(
    () => (runtime.value?.totalCount ?? 0) > resolvedMaxRows.value,
  )

  async function loadRuntime(force = false): Promise<void> {
    const key = options.watchKey.value
    if (!isEnabled.value) {
      runtime.value = null
      requestKey = ''
      return
    }
    if (!key) {
      runtime.value = null
      requestKey = ''
      return
    }
    if (!force && requestKey === key) return

    const token = ++loadToken
    requestKey = key
    loading.value = true

    try {
      const nextRuntime = await options.fetchFn()
      if (token === loadToken) {
        runtime.value = nextRuntime
      }
    } finally {
      if (token === loadToken) {
        loading.value = false
      }
    }
  }

  async function refreshRuntime(): Promise<void> {
    requestKey = ''
    await loadRuntime(true)
  }

  function updateRows(rows: Record<string, unknown>[]): void {
    if (!runtime.value) return
    runtime.value = {
      ...runtime.value,
      rows,
    }
  }

  watch(
    [options.watchKey, isEnabled],
    () => {
      void loadRuntime()
    },
    { immediate: true },
  )

  return {
    runtime,
    loading,
    hasMore,
    loadRuntime,
    refreshRuntime,
    updateRows,
  }
}
