<script lang="ts">
export default {
  name: 'AppSidebar',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import type { MenuItem } from 'primevue/menuitem'
import type Menu from 'primevue/menu'
import type Popover from 'primevue/popover'
import {
  TRANSLATION_LANGUAGE_OPTIONS,
  getTranslationLanguage,
  type TranslationLanguage,
  useTranslation,
} from '@/core/translation'
import { useNavigationMenu } from '@/core/navigation/useNavigationMenu'
import { currentUser } from '@/core/currentUser'
import FavoriteLabelDialog from './FavoriteLabelDialog.vue'
import RolePreviewSelector from './RolePreviewSelector.vue'

const emit = defineEmits<{
  'preview-active': [active: boolean]
  'preview-label': [label: string]
}>()

const COLLAPSE_STORAGE_KEY = 'crm.nav.sidebarCollapsed'

const route = useRoute()
const router = useRouter()
const { t, i18n } = useTranslation()
const {
  app,
  menuItems,
  loading,
  reload,
  removeFavoriteById,
  renameFavoriteById,
  requestAddFavorite,
  confirmAddFavorite,
  promptVisible,
  promptInitialLabel,
  goHome,
} = useNavigationMenu()

const collapsed = ref(readCollapsed())
const toggleLabel = computed(() =>
  collapsed.value
    ? t('navigation.openSidebar', 'Open sidebar')
    : t('navigation.closeSidebar', 'Close sidebar'),
)
const renameFavId = ref<string | null>(null)
const renameLabelDialogVisible = ref(false)
const renameLabelInitial = ref('')

// Footer user + settings
const userName = ref('')
const userSubtitle = ref('')
const userMenu = ref<InstanceType<typeof Popover> | null>(null)
const translationLanguage = ref<TranslationLanguage>(getTranslationLanguage())
const translationLanguageOptions = computed(() =>
  TRANSLATION_LANGUAGE_OPTIONS.map((option) => ({
    ...option,
    label: t(
      option.value === 'uk-UA' ? 'app.languageUkrainian' : 'app.languageEnglish',
      option.label,
    ),
  })),
)

// Collapsed icon-rail popup (used to surface a folder's children)
const railMenu = ref<InstanceType<typeof Menu> | null>(null)
const railItems = ref<MenuItem[]>([])

// Preserve PanelMenu expanded state across menu rebuilds.
// Favorites panel is expanded by default.
const expandedKeys = ref<Record<string, boolean>>({ __favorites__: true })

// useNavigationMenu() builds [home, favorites, ...workspace]
const primaryItems = computed(() => menuItems.value.slice(0, 2))
const workspaceItems = computed(() => menuItems.value.slice(2))

const userInitials = computed(() => {
  const source = userName.value.trim()
  if (!source) return '?'
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
})

function readCollapsed(): boolean {
  return localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true'
}

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
  localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed.value))
  railMenu.value?.hide()
}

function favoriteId(item: MenuItem): string | null {
  const value = (item as MenuItem & { favoriteId?: string }).favoriteId
  return typeof value === 'string' ? value : null
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

async function handleRemoveFavorite(item: MenuItem, event: Event): Promise<void> {
  event.stopPropagation()
  const id = favoriteId(item)
  if (id) await removeFavoriteById(id)
}

function handleRenameFavorite(item: MenuItem, event: Event): void {
  event.stopPropagation()
  const id = favoriteId(item)
  if (!id) return
  renameFavId.value = id
  renameLabelInitial.value = typeof item.label === 'string' ? item.label : ''
  renameLabelDialogVisible.value = true
}

async function handleRenameConfirm(label: string): Promise<void> {
  if (renameFavId.value) {
    await renameFavoriteById(renameFavId.value, label)
  }
  renameFavId.value = null
}

async function handleAddConfirm(label: string): Promise<void> {
  await confirmAddFavorite(label)
}

function toggleUserMenu(event: Event): void {
  userMenu.value?.toggle(event)
}

function updateTranslationLanguage(language: TranslationLanguage): void {
  i18n.setLanguage(language)
  window.location.reload()
}

onMounted(async () => {
  void reload()
  try {
    const user = await currentUser()
    // currentUser().label falls back to the raw UUID when the account has no
    // name/email; avoid surfacing that in the footer.
    const hasDisplayName = Boolean(user.label) && user.label !== user.id
    userName.value = hasDisplayName ? user.label : t('navigation.account', 'Account')
    userSubtitle.value = user.roleName || ''
  } catch {
    userName.value = ''
    userSubtitle.value = ''
  }
})

defineExpose({ reload, toggleCollapsed, collapsed })
</script>

<template>
  <aside class="app-sidebar" :class="{ 'app-sidebar--collapsed': collapsed }">
    <!-- Header: workspace switcher + collapse toggle -->
    <div class="app-sidebar__header">
      <button
        type="button"
        class="app-sidebar__workspace"
        :title="app?.label || t('navigation.appFallback', 'Helix')"
        @click="goHome"
      >
        <span class="app-sidebar__logo"><i class="pi pi-th-large" /></span>
        <span class="app-sidebar__workspace-text">
          <span class="app-sidebar__workspace-name">
            {{ app?.label || t('navigation.appFallback', 'Helix') }}
          </span>
          <span class="app-sidebar__workspace-sub">
            {{ t('navigation.appSubtitle', 'Platform') }}
          </span>
        </span>
      </button>
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
          <button
            type="button"
            class="app-sidebar__group-action"
            :aria-label="t('navigation.favoriteThisPage', 'Favorite this page')"
            :title="t('navigation.favoriteThisPage', 'Favorite this page')"
            @click="requestAddFavorite"
          >
            <i class="pi pi-star" />
          </button>
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
              <template v-if="favoriteId(item)">
                <button
                  type="button"
                  class="app-sidebar__item-action"
                  :aria-label="t('navigation.renameFavorite', 'Rename favorite')"
                  @click="handleRenameFavorite(item, $event)"
                >
                  <i class="pi pi-pencil" />
                </button>
                <button
                  type="button"
                  class="app-sidebar__item-action"
                  :aria-label="t('navigation.removeFavorite', 'Remove favorite')"
                  @click="handleRemoveFavorite(item, $event)"
                >
                  <i class="pi pi-times" />
                </button>
              </template>
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

    <!-- Footer: user card + settings popover -->
    <div class="app-sidebar__footer">
      <button
        v-tooltip.right="collapsed ? userName : ''"
        type="button"
        class="app-sidebar__user"
        @click="toggleUserMenu"
      >
        <Avatar :label="userInitials" shape="circle" size="normal" />
        <span class="app-sidebar__user-text">
          <span class="app-sidebar__user-name">{{ userName }}</span>
          <span class="app-sidebar__user-sub">{{ userSubtitle }}</span>
        </span>
        <i class="pi pi-chevron-up app-sidebar__user-caret" />
      </button>

      <Popover ref="userMenu">
        <div class="app-sidebar__user-panel">
          <RolePreviewSelector
            @preview-active="emit('preview-active', $event)"
            @preview-label="emit('preview-label', $event)"
          />
          <div class="app-sidebar__user-panel-row">
            <label
              class="text-muted-color text-[0.8rem] font-semibold"
              for="crm-language"
            >
              {{ t('app.language', 'Language') }}
            </label>
            <Select
              id="crm-language"
              :model-value="translationLanguage"
              :options="translationLanguageOptions"
              option-label="label"
              option-value="value"
              size="small"
              @update:model-value="updateTranslationLanguage"
            />
          </div>
        </div>
      </Popover>
    </div>
  </aside>

  <!-- Add-favorite label prompt -->
  <FavoriteLabelDialog
    v-model:visible="promptVisible"
    :initial-label="promptInitialLabel"
    @confirm="handleAddConfirm"
  />

  <!-- Rename-favorite label prompt -->
  <FavoriteLabelDialog
    v-model:visible="renameLabelDialogVisible"
    :initial-label="renameLabelInitial"
    @confirm="handleRenameConfirm"
  />
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 264px;
  min-width: 264px;
  height: 100vh;
  position: sticky;
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
  gap: 0.25rem;
  min-height: 2.25rem;
}

.app-sidebar__workspace {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1 1 auto;
  min-width: 0;
  padding: 0.35rem;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
  transition: opacity 0.16s ease, flex-basis 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.app-sidebar--collapsed .app-sidebar__workspace {
  flex: 0 0 0;
  width: 0;
  min-width: 0;
  padding: 0;
  opacity: 0;
  pointer-events: none;
}

.app-sidebar__workspace:hover {
  background: var(--p-surface-100, #f3f4f6);
}

.app-sidebar__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  background: var(--p-primary-color, #10b981);
  color: var(--p-primary-contrast-color, #fff);
  flex: 0 0 auto;
}

.app-sidebar__workspace-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  text-align: left;
}

.app-sidebar__workspace-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--p-text-color, #1f2937);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-sidebar__workspace-sub {
  font-size: 0.72rem;
  color: var(--p-text-muted-color, #9ca3af);
}

.app-sidebar__toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 auto;
  margin-left: auto;
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

/* Footer */
.app-sidebar__footer {
  margin-top: auto;
  flex-shrink: 0;
  border-top: 1px solid var(--p-surface-200, #e5e7eb);
  padding-top: 0.5rem;
}

.app-sidebar__user {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  min-width: 0;
  padding: 0.35rem;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  cursor: pointer;
}

.app-sidebar__user:hover {
  background: var(--p-surface-100, #f3f4f6);
}

.app-sidebar--collapsed .app-sidebar__footer {
  border-top-color: transparent;
}

.app-sidebar--collapsed .app-sidebar__user {
  justify-content: center;
}

.app-sidebar--collapsed .app-sidebar__user-text,
.app-sidebar--collapsed .app-sidebar__user-caret {
  display: none;
}

.app-sidebar__user-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
  text-align: left;
}

.app-sidebar__user-name {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--p-text-color, #1f2937);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-sidebar__user-sub {
  font-size: 0.72rem;
  color: var(--p-text-muted-color, #9ca3af);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-sidebar__user-caret {
  flex: 0 0 auto;
  color: var(--p-text-muted-color, #9ca3af);
  font-size: 0.75rem;
}

.app-sidebar__user-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 15rem;
}

.app-sidebar__user-panel-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.app-sidebar__loading {
  display: flex;
  justify-content: center;
  padding: 1rem 0;
}
</style>
