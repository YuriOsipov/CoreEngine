<script lang="ts">
export default {
  name: 'AppHeaderUtilities',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type Popover from 'openvue/popover'
import { useToast } from 'openvue/usetoast'
import {
  TRANSLATION_LANGUAGE_OPTIONS,
  getTranslationLanguage,
  type TranslationLanguage,
  useTranslation,
} from '@/core/translation'
import { useNavigationMenu } from '@/core/navigation/useNavigationMenu'
import { useFavoriteContext } from '@/core/navigation/useFavoriteContext'
import {
  favoriteTargetMatchesRoute,
  resolveNavTarget,
} from '@/core/navigation/navTargetRoute'
import { currentUser } from '@/core/currentUser'
import { canUseBffAuth, logoutWithBff } from '@/core/auth/session'
import FavoriteLabelDialog from './FavoriteLabelDialog.vue'
import RolePreviewSelector from './RolePreviewSelector.vue'
import type { NavLink } from '@/interfaces'

const emit = defineEmits<{
  'preview-active': [active: boolean]
  'preview-label': [label: string]
}>()

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { t, i18n } = useTranslation()
const {
  app,
  favorites,
  reload,
  removeFavoriteById,
  renameFavoriteById,
  addCurrentPageFavorite,
  goHome,
} = useNavigationMenu()
const { context: favoriteContext } = useFavoriteContext()

const favoriteToggleBusy = ref(false)

/** SF-style: fill/highlight the star when this page is already favorited. */
const currentFavoriteLink = computed(() => {
  const homeTarget = app.value?.home
  const fullPath = route.fullPath
  return (
    favorites.value.find((link) =>
      favoriteTargetMatchesRoute(link.target, fullPath, homeTarget, (to) =>
        router.resolve(to),
      ),
    ) ?? null
  )
})

const currentPageIsFavorite = computed(() => currentFavoriteLink.value != null)

function isFavoriteLinkActive(link: NavLink): boolean {
  return favoriteTargetMatchesRoute(
    link.target,
    route.fullPath,
    app.value?.home,
    (to) => router.resolve(to),
  )
}

const favoritesPopover = ref<InstanceType<typeof Popover> | null>(null)
const userPopover = ref<InstanceType<typeof Popover> | null>(null)
const loggingOut = ref(false)
const userName = ref('')
const userSubtitle = ref('')
const renameFavId = ref<string | null>(null)
const renameLabelDialogVisible = ref(false)
const renameLabelInitial = ref('')
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

const brandLabel = computed(
  () => app.value?.label?.trim() || t('navigation.appFallback', 'CoreEngine'),
)

const userInitials = computed(() => {
  const source = userName.value.trim()
  if (!source) return '?'
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
})

function openFavoritesList(event: Event): void {
  favoritesPopover.value?.toggle(event)
}

function toggleUser(event: Event): void {
  userPopover.value?.toggle(event)
}

function openSetup(): void {
  void router.push('/setup')
}

function openFavorite(link: NavLink): void {
  favoritesPopover.value?.hide()
  const homeTarget = app.value?.home ?? { kind: 'home' as const }
  const resolved = resolveNavTarget(link.target, homeTarget)
  if (resolved.href) {
    window.open(resolved.href, '_blank', 'noopener')
    return
  }
  if (resolved.to) {
    void router.push(resolved.to)
  }
}

function currentFavoriteLabel(): string {
  const ctxLabel = favoriteContext.value?.defaultLabel?.trim()
  if (ctxLabel) return ctxLabel
  const metaTitle = (route.meta as Record<string, unknown>).title
  if (typeof metaTitle === 'string' && metaTitle.trim()) return metaTitle.trim()
  if (typeof route.name === 'string' && route.name.trim()) return route.name
  return route.fullPath
}

/** Star click: add current page (or remove if already favorited). */
async function toggleCurrentPageFavorite(): Promise<void> {
  if (favoriteToggleBusy.value) return
  favoriteToggleBusy.value = true
  try {
    const existing = currentFavoriteLink.value
    if (existing) {
      await removeFavoriteById(existing.id)
      return
    }
    const label = currentFavoriteLabel()
    await addCurrentPageFavorite()
    toast.add({
      severity: 'success',
      summary: t('navigation.favoriteAdded', 'Added to favorites'),
      detail: label,
      life: 3000,
    })
  } catch {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: t('navigation.favoriteAddError', 'Failed to add favorite.'),
      life: 4000,
    })
  } finally {
    favoriteToggleBusy.value = false
  }
}

function handleRenameFavorite(link: NavLink, event: Event): void {
  event.stopPropagation()
  renameFavId.value = link.id
  renameLabelInitial.value = link.label
  renameLabelDialogVisible.value = true
}

async function handleRemoveFavorite(link: NavLink, event: Event): Promise<void> {
  event.stopPropagation()
  await removeFavoriteById(link.id)
}

async function handleRenameConfirm(label: string): Promise<void> {
  if (renameFavId.value) {
    await renameFavoriteById(renameFavId.value, label)
  }
  renameFavId.value = null
}

function updateTranslationLanguage(language: TranslationLanguage): void {
  i18n.setLanguage(language)
  window.location.reload()
}

async function handleLogout(): Promise<void> {
  loggingOut.value = true
  try {
    await logoutWithBff()
    await router.replace({ name: 'login' })
  } finally {
    loggingOut.value = false
  }
}

onMounted(async () => {
  void reload()
  try {
    const user = await currentUser()
    const hasDisplayName = Boolean(user.label) && user.label !== user.id
    userName.value = hasDisplayName ? user.label : t('navigation.account', 'Account')
    userSubtitle.value = user.roleName || ''
  } catch {
    userName.value = ''
    userSubtitle.value = ''
  }
})

defineExpose({ reload })
</script>

<template>
  <header class="app-top-bar" role="banner">
    <button
      type="button"
      class="app-top-bar__brand"
      :title="brandLabel"
      @click="goHome"
    >
      <span class="app-top-bar__logo" aria-hidden="true">
        <i class="pi pi-building" />
      </span>
      <span class="app-top-bar__brand-text">{{ brandLabel }}</span>
    </button>

    <div class="app-top-bar__spacer" />

    <div class="app-top-bar__actions">
      <div class="app-top-bar__favorites-control">
        <Button
          type="button"
          :icon="currentPageIsFavorite ? 'pi pi-star-fill' : 'pi pi-star'"
          text
          rounded
          :severity="currentPageIsFavorite ? 'primary' : 'secondary'"
          class="app-top-bar__icon-btn app-top-bar__favorites-star"
          :class="{ 'app-top-bar__icon-btn--favorite-active': currentPageIsFavorite }"
          :loading="favoriteToggleBusy"
          :aria-label="
            currentPageIsFavorite
              ? t('navigation.removeFavorite', 'Remove favorite')
              : t('navigation.favoriteThisPage', 'Favorite this page')
          "
          :aria-pressed="currentPageIsFavorite"
          :title="
            currentPageIsFavorite
              ? t('navigation.favoritesCurrentPage', 'This page is in favorites')
              : t('navigation.favoriteThisPage', 'Favorite this page')
          "
          @click="toggleCurrentPageFavorite"
        />
        <Button
          type="button"
          icon="pi pi-chevron-down"
          text
          rounded
          severity="secondary"
          class="app-top-bar__icon-btn app-top-bar__favorites-caret"
          :aria-label="t('navigation.favoritesList', 'Favorites list')"
          :title="t('navigation.favoritesList', 'Favorites list')"
          :aria-haspopup="true"
          @click="openFavoritesList"
        />
        <Popover ref="favoritesPopover" class="app-top-bar__popover">
          <div class="app-top-bar__favorites">
            <div class="app-top-bar__favorites-header">
              <div class="app-top-bar__favorites-title">
                {{ t('navigation.myFavorites', 'My Favorites') }}
              </div>
            </div>
            <ul
              v-if="favorites.length"
              class="app-top-bar__favorites-list"
            >
              <li
                v-for="link in favorites"
                :key="link.id"
                class="app-top-bar__favorites-item"
                :class="{ 'app-top-bar__favorites-item--active': isFavoriteLinkActive(link) }"
              >
                <button
                  type="button"
                  class="app-top-bar__favorites-link"
                  @click="openFavorite(link)"
                >
                  <i :class="link.icon || 'pi pi-star'" class="app-top-bar__favorites-icon" />
                  <span class="app-top-bar__favorites-label">{{ link.label }}</span>
                </button>
                <button
                  type="button"
                  class="app-top-bar__favorites-action"
                  :aria-label="t('navigation.renameFavorite', 'Rename favorite')"
                  :title="t('navigation.renameFavorite', 'Rename favorite')"
                  @click="handleRenameFavorite(link, $event)"
                >
                  <i class="pi pi-pencil" />
                </button>
                <button
                  type="button"
                  class="app-top-bar__favorites-action"
                  :aria-label="t('navigation.removeFavorite', 'Remove favorite')"
                  :title="t('navigation.removeFavorite', 'Remove favorite')"
                  @click="handleRemoveFavorite(link, $event)"
                >
                  <i class="pi pi-times" />
                </button>
              </li>
            </ul>
            <p
              v-else
              class="app-top-bar__favorites-empty"
            >
              {{ t('navigation.favoritesEmpty', 'No favorites yet') }}
            </p>
          </div>
        </Popover>
      </div>

      <Button
        type="button"
        icon="pi pi-cog"
        text
        rounded
        severity="secondary"
        class="app-top-bar__icon-btn"
        :aria-label="t('setup.title', 'Setup')"
        :title="t('setup.title', 'Setup')"
        @click="openSetup"
      />

      <button
        type="button"
        class="app-top-bar__avatar-btn"
        :aria-label="userName || t('navigation.account', 'Account')"
        :title="userName || t('navigation.account', 'Account')"
        @click="toggleUser"
      >
        <Avatar
          :label="userInitials"
          shape="circle"
          size="normal"
        />
      </button>
      <Popover ref="userPopover" class="app-top-bar__popover">
        <div class="app-top-bar__user-panel">
          <div class="app-top-bar__user-identity">
            <span class="app-top-bar__user-name">{{ userName }}</span>
            <span
              v-if="userSubtitle"
              class="app-top-bar__user-sub"
            >{{ userSubtitle }}</span>
          </div>
          <RolePreviewSelector
            @preview-active="emit('preview-active', $event)"
            @preview-label="emit('preview-label', $event)"
          />
          <div class="app-top-bar__user-row">
            <label
              class="text-muted-color text-[0.8rem] font-semibold"
              for="crm-topbar-language"
            >
              {{ t('app.language', 'Language') }}
            </label>
            <Select
              id="crm-topbar-language"
              :model-value="translationLanguage"
              :options="translationLanguageOptions"
              option-label="label"
              option-value="value"
              size="small"
              @update:model-value="updateTranslationLanguage"
            />
          </div>
          <Button
            v-if="canUseBffAuth()"
            :label="t('auth.signOut', 'Sign out')"
            icon="pi pi-sign-out"
            text
            size="small"
            class="w-full justify-start"
            :loading="loggingOut"
            @click="handleLogout"
          />
        </div>
      </Popover>
    </div>

    <FavoriteLabelDialog
      v-model:visible="renameLabelDialogVisible"
      :initial-label="renameLabelInitial"
      @confirm="handleRenameConfirm"
    />
  </header>
</template>

<style scoped>
.app-top-bar {
  align-items: center;
  background: var(--p-surface-0, #fff);
  border-bottom: 1px solid var(--p-content-border-color, #e2e8f0);
  display: flex;
  flex: 0 0 auto;
  gap: 0.75rem;
  min-height: 2.75rem;
  padding: 0.35rem 0.85rem;
  position: relative;
  z-index: 40;
}

.app-top-bar__brand {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 0.4rem;
  color: var(--p-surface-900, #0f172a);
  cursor: pointer;
  display: inline-flex;
  gap: 0.55rem;
  min-width: 0;
  padding: 0.2rem 0.35rem;
}

.app-top-bar__brand:hover {
  background: var(--p-content-hover-background, rgba(15, 23, 42, 0.04));
}

.app-top-bar__logo {
  align-items: center;
  background: var(--p-primary-color, #0f766e);
  border-radius: 0.4rem;
  color: #fff;
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 0.95rem;
  height: 1.85rem;
  justify-content: center;
  width: 1.85rem;
}

.app-top-bar__brand-text {
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-top-bar__spacer {
  flex: 1 1 auto;
  min-width: 0.5rem;
}

.app-top-bar__actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.15rem;
}

.app-top-bar__icon-btn {
  height: 2.15rem;
  width: 2.15rem;
}

.app-top-bar__favorites-control {
  align-items: center;
  display: inline-flex;
  gap: 0;
}

.app-top-bar__favorites-star {
  border-bottom-right-radius: 0;
  border-top-right-radius: 0;
}

.app-top-bar__favorites-caret {
  border-bottom-left-radius: 0;
  border-top-left-radius: 0;
  margin-left: -0.15rem;
  width: 1.65rem;
}

.app-top-bar__icon-btn--favorite-active {
  background: color-mix(in srgb, var(--p-primary-color, #0f766e) 14%, transparent);
  color: var(--p-primary-color, #0f766e);
}

.app-top-bar__favorites-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.app-top-bar__avatar-btn {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  display: inline-flex;
  margin-left: 0.15rem;
  padding: 0.1rem;
}

.app-top-bar__avatar-btn:hover {
  background: var(--p-content-hover-background, rgba(15, 23, 42, 0.04));
}

.app-top-bar__favorites {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 16rem;
  max-width: 22rem;
}

.app-top-bar__favorites-title {
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.35rem;
  text-transform: uppercase;
}

.app-top-bar__favorites-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  list-style: none;
  margin: 0;
  max-height: 18rem;
  overflow: auto;
  padding: 0;
}

.app-top-bar__favorites-item {
  align-items: center;
  border-radius: 0.4rem;
  display: flex;
  gap: 0.15rem;
  min-width: 0;
}

.app-top-bar__favorites-item:hover {
  background: var(--p-content-hover-background, rgba(15, 23, 42, 0.04));
}

.app-top-bar__favorites-item--active {
  background: color-mix(in srgb, var(--p-primary-color, #0f766e) 12%, transparent);
}

.app-top-bar__favorites-item--active .app-top-bar__favorites-label {
  font-weight: 600;
}

.app-top-bar__favorites-link {
  align-items: center;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  flex: 1 1 auto;
  font: inherit;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.45rem 0.4rem;
  text-align: left;
}

.app-top-bar__favorites-icon {
  color: var(--p-primary-color, #0f766e);
  flex: 0 0 auto;
  font-size: 0.9rem;
}

.app-top-bar__favorites-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-top-bar__favorites-action {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 0.3rem;
  color: var(--p-text-muted-color, #64748b);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  height: 1.65rem;
  justify-content: center;
  opacity: 0;
  width: 1.65rem;
}

.app-top-bar__favorites-item:hover .app-top-bar__favorites-action {
  opacity: 1;
}

.app-top-bar__favorites-empty {
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.85rem;
  margin: 0;
  padding: 0.5rem 0.4rem;
}

.app-top-bar__user-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 14rem;
}

.app-top-bar__user-identity {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0 0.15rem;
}

.app-top-bar__user-name {
  font-size: 0.9rem;
  font-weight: 600;
}

.app-top-bar__user-sub {
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.8rem;
}

.app-top-bar__user-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
</style>
