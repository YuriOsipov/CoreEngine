import { ref, type Ref } from 'vue'
import { loadAppRoles } from '@/core/settingRoleUtils'
import type { AppRoleOption, SavedRoleScopedLayout } from '@/interfaces'

export interface UseRoleScopedLayoutOptions<TLayout> {
  collection: Ref<string>
  enabled: Ref<boolean>
  loadLayouts: (collection: string) => Promise<SavedRoleScopedLayout[]>
  loadLayoutById: (collection: string, layoutId: string) => Promise<TLayout | null>
  createDefaultLayout: (collection: string) => TLayout
  humanizeCollection?: (collection: string) => string
}

export function useRoleScopedLayout<TLayout>(options: UseRoleScopedLayoutOptions<TLayout>) {

  const layoutSchema = ref(options.createDefaultLayout('')) as Ref<TLayout>
  const layoutLoading = ref(false)
  const layoutDeleting = ref(false)
  const layouts = ref<SavedRoleScopedLayout[]>([])
  const roleOptions = ref<AppRoleOption[]>([])
  const selectedLayoutId = ref<string | null>(null)
  const layoutName = ref('')
  const layoutRoleId = ref<string | null>(null)

  let loadToken = 0

  function humanize(name: string): string {
    return options.humanizeCollection?.(name) ?? name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
  }

  function applySelectedLayout(layout: SavedRoleScopedLayout | null, collectionName: string): void {
    selectedLayoutId.value = layout?.id ?? null
    layoutName.value = layout?.name ?? humanize(collectionName)
    layoutRoleId.value = layout?.roleId ?? null
  }

  async function loadLayoutBody(layoutId: string | null, collectionName: string): Promise<void> {
    const token = ++loadToken
    layoutLoading.value = true

    try {
      const saved = layoutId
        ? await options.loadLayoutById(collectionName, layoutId)
        : null
      if (token !== loadToken) return
      layoutSchema.value = saved ?? options.createDefaultLayout(collectionName)
    } catch {
      if (token !== loadToken) return
      layoutSchema.value = options.createDefaultLayout(collectionName)
    } finally {
      if (token === loadToken) {
        layoutLoading.value = false
      }
    }
  }

  async function loadForCollection(collectionName: string): Promise<void> {
    layoutLoading.value = true
    try {
      const [nextLayouts, roles] = await Promise.all([
        options.loadLayouts(collectionName),
        loadAppRoles(),
      ])
      layouts.value = nextLayouts
      roleOptions.value = roles

      const preferred =
        nextLayouts.find((layout) => layout.roleId === null) ?? nextLayouts[0] ?? null
      applySelectedLayout(preferred, collectionName)
      await loadLayoutBody(preferred?.id ?? null, collectionName)
    } catch {
      layouts.value = []
      roleOptions.value = []
      applySelectedLayout(null, collectionName)
      layoutSchema.value = options.createDefaultLayout(collectionName)
      layoutLoading.value = false
    }
  }

  async function selectLayout(layoutId: string): Promise<void> {
    const layout = layouts.value.find((entry) => entry.id === layoutId)
    if (!layout) return
    applySelectedLayout(layout, options.collection.value)
    await loadLayoutBody(layout.id, options.collection.value)
  }

  function createLayoutDraft(): void {
    applySelectedLayout(null, options.collection.value)
    layoutSchema.value = options.createDefaultLayout(options.collection.value)
  }

  function getSaveOptions() {
    return {
      layoutId: selectedLayoutId.value,
      name: layoutName.value.trim(),
      roleId: layoutRoleId.value,
    }
  }

  function applySavedLayout(saved: SavedRoleScopedLayout, allLayouts: SavedRoleScopedLayout[]): void {
    layouts.value = allLayouts
    applySelectedLayout(
      allLayouts.find((layout) => layout.id === saved.id) ?? saved,
      options.collection.value,
    )
    selectedLayoutId.value = saved.id
  }

  return {
    layoutSchema,
    layoutLoading,
    layoutDeleting,
    layouts,
    roleOptions,
    selectedLayoutId,
    layoutName,
    layoutRoleId,
    loadForCollection,
    selectLayout,
    createLayoutDraft,
    getSaveOptions,
    applySavedLayout,
    humanize,
  }
}
