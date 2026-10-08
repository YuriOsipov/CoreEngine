import { computed, ref, watch, type Ref } from 'vue'
import { useTranslation } from '@/core/translation'
import type { SetupLayoutListItem } from '@/interfaces'
import { loadSetupLayoutList } from '../services/setupLayoutRegistry'
import type { SetupLayoutType } from '../types/setupLayoutType'

export function useSetupLayoutList(
  collection: Ref<string>,
  layoutType: Ref<SetupLayoutType>,
) {
  const { t } = useTranslation()
  const layouts = ref<SetupLayoutListItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const searchQuery = ref('')

  const filteredLayouts = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    if (!query) return layouts.value

    return layouts.value.filter((layout) => {
      const roleLabel = layout.roleName ?? t('layoutRole.defaultRole', 'Default (all roles)')
      return (
        layout.name.toLowerCase().includes(query)
        || roleLabel.toLowerCase().includes(query)
      )
    })
  })

  async function refresh(): Promise<void> {
    if (!collection.value) {
      layouts.value = []
      return
    }

    loading.value = true
    error.value = null
    try {
      layouts.value = await loadSetupLayoutList(collection.value, layoutType.value)
    } catch (err) {
      layouts.value = []
      error.value =
        err instanceof Error
          ? err.message
          : t('setup.loadLayoutsError', 'Failed to load layout configurations.')
    } finally {
      loading.value = false
    }
  }

  watch(
    [collection, layoutType],
    () => {
      searchQuery.value = ''
      void refresh()
    },
    { immediate: true },
  )

  return {
    layouts,
    filteredLayouts,
    loading,
    error,
    searchQuery,
    refresh,
  }
}
