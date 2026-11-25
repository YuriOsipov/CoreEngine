<script lang="ts">
export default {
  name: 'SetupSidebar',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useTranslation } from '@/core/translation'
import {
  isSetupNavItemActive,
  type SetupNavGroupView,
} from './setupNavItems'

const props = defineProps<{
  groups: SetupNavGroupView[]
}>()

const route = useRoute()
const { t } = useTranslation()
const quickFind = ref('')
const collapsedGroupIds = ref<Set<string>>(new Set())

const filteredGroups = computed(() => {
  const query = quickFind.value.trim().toLowerCase()
  if (!query) return props.groups

  return props.groups
    .map((group) => {
      const items = group.items.filter((item) =>
        item.label.toLowerCase().includes(query),
      )
      if (!items.length) return null
      return { ...group, items }
    })
    .filter((group): group is SetupNavGroupView => group != null)
})

function isGroupExpanded(groupId: string): boolean {
  if (quickFind.value.trim()) return true
  if (collapsedGroupIds.value.has(groupId)) return false
  return true
}

function toggleGroup(groupId: string): void {
  if (quickFind.value.trim()) return
  const next = new Set(collapsedGroupIds.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  collapsedGroupIds.value = next
}

function ensureActiveGroupExpanded(): void {
  for (const group of props.groups) {
    const hasActive = group.items.some((item) =>
      isSetupNavItemActive(route.path, item.to),
    )
    if (!hasActive) continue
    if (collapsedGroupIds.value.has(group.id)) {
      const next = new Set(collapsedGroupIds.value)
      next.delete(group.id)
      collapsedGroupIds.value = next
    }
  }
}

watch(
  () => [route.path, props.groups] as const,
  () => {
    ensureActiveGroupExpanded()
  },
  { immediate: true, deep: true },
)
</script>

<template>
  <aside
    class="setup-sidebar"
    :aria-label="t('setup.sidebarNav', 'Setup navigation')"
  >
    <RouterLink
      :to="{ name: 'home' }"
      class="setup-sidebar__back"
    >
      <i class="pi pi-chevron-left" aria-hidden="true" />
      <span>{{ t('setup.backToApp', 'Back to app') }}</span>
    </RouterLink>

    <div class="setup-sidebar__search">
      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="quickFind"
          class="w-full setup-sidebar__quick-find"
          :placeholder="t('setup.quickFind', 'Quick Find')"
          :aria-label="t('setup.quickFind', 'Quick Find')"
        />
      </IconField>
    </div>

    <nav class="setup-sidebar__nav">
      <div
        v-for="group in filteredGroups"
        :key="group.id"
        class="setup-sidebar__group"
      >
        <button
          type="button"
          class="setup-sidebar__group-toggle"
          :aria-expanded="isGroupExpanded(group.id)"
          @click="toggleGroup(group.id)"
        >
          <i
            class="pi setup-sidebar__chevron"
            :class="isGroupExpanded(group.id) ? 'pi-chevron-down' : 'pi-chevron-right'"
            aria-hidden="true"
          />
          <span>{{ group.label }}</span>
        </button>

        <div
          v-show="isGroupExpanded(group.id)"
          class="setup-layout-nav setup-sidebar__items"
        >
          <RouterLink
            v-for="item in group.items"
            :key="item.id"
            :to="item.to"
            class="setup-layout-nav__item setup-sidebar__link"
            :class="{
              'setup-layout-nav__item--active': isSetupNavItemActive(route.path, item.to),
            }"
          >
            {{ item.label }}
          </RouterLink>
        </div>
      </div>

      <p
        v-if="!filteredGroups.length"
        class="setup-sidebar__empty text-muted-color"
      >
        {{ t('setup.nav.noMatches', 'No matching Setup pages.') }}
      </p>
    </nav>
  </aside>
</template>
