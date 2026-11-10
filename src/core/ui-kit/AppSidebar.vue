<script lang="ts">
export default {
  name: 'AppSidebar',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import type { MenuItem } from 'openvue/menuitem'
import type Menu from 'openvue/menu'
import { useTranslation } from '@/core/translation'
import { useNavigationMenu } from '@/core/navigation/useNavigationMenu'

const COLLAPSE_STORAGE_KEY = 'crm.nav.sidebarCollapsed'

const route = useRoute()
const router = useRouter()
const { t } = useTranslation()
const {
  menuItems,
  loading,
  reload,
} = useNavigationMenu()

const collapsed = ref(readCollapsed())
const toggleLabel = computed(() =>
  collapsed.value
    ? t('navigation.openSidebar', 'Open sidebar')
    : t('navigation.closeSidebar', 'Close sidebar'),
)

// Collapsed icon-rail popup (used to surface a folder's children)
const railMenu = ref<InstanceType<typeof Menu> | null>(null)
const railItems = ref<MenuItem[]>([])

// Preserve PanelMenu expanded state across menu rebuilds.
const expandedKeys = ref<Record<string, boolean>>({})

// useNavigationMenu() builds [home, ...workspace] — favorites live in the top bar.
const primaryItems = computed(() => menuItems.value.slice(0, 1))
const workspaceItems = computed(() => menuItems.value.slice(1))

function readCollapsed(): boolean {
  return localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true'
}

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
  localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed.value))
  railMenu.value?.hide()
}

function hasChildren(item: MenuItem): boolean {
  return Array.isArray(item.items) && item.items.length > 0
}

function itemRoute(item: MenuItem): RouteLocationRaw | undefined {
  return (item as MenuItem & { navTo?: RouteLocationRaw }).navTo
}

// A folder is active when any descendant matches; a leaf matches its route.
function isItemActive(item: MenuItem): boolean {
  if (hasChildren(item)) {
    return (item.items ?? []).some(isItemActive)
  }
  const to = itemRoute(item)
  if (!to) return false
  try {
    return router.resolve(to).fullPath === route.fullPath
  } catch {
    return false
  }
}

function handleMenuItemActivate(item: MenuItem, event: MouseEvent): void {
  // Let PanelMenu handle expand/collapse for group nodes.
  if (hasChildren(item)) return

  const to = itemRoute(item)
  if (to) {
    if (event.ctrlKey || event.metaKey) {
      // Open in new tab on Ctrl/Cmd + click
      const url = router.resolve(to).href
      window.open(url, '_blank')
    } else {
      // Force SPA navigation for leaf nodes by blocking native anchor behavior.
      event.preventDefault()
      event.stopPropagation()
      if (typeof item.command === 'function') {
        item.command({ originalEvent: event, item })
      }
    }
  }
}

function handleRailActivate(item: MenuItem, event: MouseEvent): void {
  if (hasChildren(item)) {
    railItems.value = item.items ?? []
    railMenu.value?.toggle(event)
    return
  }
  const to = itemRoute(item)
  if (to) {
    if (event.ctrlKey || event.metaKey) {
      // Open in new tab on Ctrl/Cmd + click
      const url = router.resolve(to).href
      window.open(url, '_blank')
    } else {
      if (typeof item.command === 'function') {
        item.command({ originalEvent: event, item })
      }
    }
  }
}

onMounted(() => {
  void reload()
})

defineExpose({ reload, toggleCollapsed, collapsed })
</script>

<template>
  <aside class="app-sidebar" :class="{ 'app-sidebar--collapsed': collapsed }">
    <!-- Header: collapse toggle only (app branding lives in the top bar) -->
    <div class="app-sidebar__header">
      <button
        v-tooltip.right="toggleLabel"
        type="button"
        class="app-sidebar__toggle"
        :aria-label="toggleLabel"
        :aria-expanded="!collapsed"
        @click="toggleCollapsed"
      >
        <svg class="app-sidebar__toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect
            x="3.5"
            y="3.5"
            width="17"
            height="17"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
          />
          <path d="M9.25 3.5v17" fill="none" stroke="currentColor" stroke-width="1.75" />
        </svg>
      </button>
    </div>

    <div v-if="loading" class="app-sidebar__loading">
      <ProgressSpinner stroke-width="4" style="width: 1.5rem; height: 1.5rem" />
    </div>

    <div v-else class="app-sidebar__body">
      <!-- Expanded content -->
      <div class="app-sidebar__content" :inert="collapsed">
      <div class="app-sidebar__group">
        <div class="app-sidebar__group-label">
          <span>{{ t('navigation.menu', 'Menu') }}</span>
        </div>
        <PanelMenu v-model:expandedKeys="expandedKeys" :model="primaryItems" multiple class="app-sidebar__menu">
          <template #item="{ item }">
            <div
              class="app-sidebar__item"
              :class="{ 'app-sidebar__item--active': isItemActive(item) }"
              @click="handleMenuItemActivate(item, $event)"
            >
              <i v-if="item.icon" :class="item.icon" class="app-sidebar__item-icon" />
              <span class="app-sidebar__item-label">{{ item.label }}</span>
            </div>
          </template>
        </PanelMenu>
      </div>

      <div v-if="workspaceItems.length" class="app-sidebar__group">
        <div class="app-sidebar__group-label">
          <span>{{ t('navigation.workspace', 'Workspace') }}</span>
        </div>
        <PanelMenu v-model:expandedKeys="expandedKeys" :model="workspaceItems" multiple class="app-sidebar__menu">
          <template #item="{ item }">
            <div
              class="app-sidebar__item"
              :class="{ 'app-sidebar__item--active': isItemActive(item) }"
              @click="handleMenuItemActivate(item, $event)"
            >
              <i v-if="item.icon" :class="item.icon" class="app-sidebar__item-icon" />
              <span class="app-sidebar__item-label">{{ item.label }}</span>
            </div>
          </template>
        </PanelMenu>
      </div>
    </div>

    <!-- Collapsed icon rail -->
    <div class="app-sidebar__rail" :inert="!collapsed">
      <button
        v-for="(item, index) in menuItems"
        :key="item.key ?? index"
        v-tooltip.right="item.label"
        type="button"
        class="app-sidebar__rail-item"
        :class="{ 'app-sidebar__rail-item--active': isItemActive(item) }"
        @click="handleRailActivate(item, $event)"
      >
        <i :class="item.icon || 'pi pi-circle'" />
      </button>
      <Menu ref="railMenu" :model="railItems" popup />
    </div>
    </div>

  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 264px;
  min-width: 264px;
  height: 100%;
  position: relative;
  top: 0;
  overflow: hidden;
  flex-shrink: 0;
  padding: 0.5rem;
  border-right: 1px solid var(--p-surface-200, #e5e7eb);
  background: var(--p-surface-0, #fff);
  transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.app-sidebar--collapsed {
  width: 52px;
  min-width: 52px;
}

@media (prefers-reduced-motion: reduce) {
  .app-sidebar {
    transition: none;
  }
}

/* Header */
.app-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 2.25rem;
}

.app-sidebar--collapsed .app-sidebar__header {
  justify-content: center;
}

.app-sidebar__toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 auto;
  padding: 0;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--p-text-color, #1f2937);
  cursor: pointer;
}

.app-sidebar__toggle:hover {
  background: var(--p-surface-100, #f3f4f6);
}

.app-sidebar__toggle:focus-visible {
  outline: 2px solid var(--p-primary-color, #10b981);
  outline-offset: 1px;
}

.app-sidebar__toggle-icon {
  width: 1.25rem;
  height: 1.25rem;
  display: block;
}

/* Content + groups */
.app-sidebar__body {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}

.app-sidebar__content,
.app-sidebar__rail {
  position: absolute;
  inset: 0;
  overflow-x: hidden;
  overflow-y: auto;
  transition: opacity 0.16s ease;
}

.app-sidebar--collapsed .app-sidebar__content,
.app-sidebar:not(.app-sidebar--collapsed) .app-sidebar__rail {
  opacity: 0;
  pointer-events: none;
}

.app-sidebar__content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.app-sidebar__group-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.5rem;
  margin-bottom: 0.25rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--p-text-muted-color, #9ca3af);
}

.app-sidebar__group-action {
  border: none;
  background: transparent;
  color: var(--p-text-muted-color, #9ca3af);
  cursor: pointer;
}

.app-sidebar__group-action:hover {
  color: var(--p-primary-color, #10b981);
}

/* Menu items */
  .app-sidebar__item {
    cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-width: 0;
  padding: 0.15rem 0;
  border-radius: 0.5rem;
}

.app-sidebar__item--active {
  background: var(--p-highlight-background, color-mix(in srgb, var(--p-primary-color, #10b981) 12%, transparent));
  color: var(--p-highlight-color, var(--p-primary-color, #10b981));
  font-weight: 600;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
}

.app-sidebar__item--active .app-sidebar__item-icon {
  color: var(--p-highlight-color, var(--p-primary-color, #10b981));
}

.app-sidebar__item-label {
  flex: 1 1 auto;
  min-width: 0;
  word-break: break-word;
  line-height: 1.35;
}

.app-sidebar__item-action {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--p-text-muted-color, #9ca3af);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
  padding: 0 2px;
  font-size: 0.75rem;
}

.app-sidebar__item:hover .app-sidebar__item-action {
  opacity: 1;
}

/* Collapsed rail */
.app-sidebar__rail {
  flex: 1 1 auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.app-sidebar__rail-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--p-text-color, #1f2937);
  cursor: pointer;
}

.app-sidebar__rail-item:hover {
  background: var(--p-surface-100, #f3f4f6);
}

.app-sidebar__rail-item--active {
  background: var(--p-highlight-background, color-mix(in srgb, var(--p-primary-color, #10b981) 12%, transparent));
  color: var(--p-highlight-color, var(--p-primary-color, #10b981));
}

.app-sidebar__loading {
  display: flex;
  justify-content: center;
  padding: 1rem 0;
}
</style>
