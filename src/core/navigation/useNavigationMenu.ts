import { ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import type { MenuItem } from 'primevue/menuitem'
import type { NavItem, NavLink, NavTarget, NavigationApp } from '@/interfaces'
import { useTranslation } from '@/core/translation'
import {
  addFavorite as addFavoriteRecord,
  loadFavorites,
  removeFavorite as removeFavoriteRecord,
  renameFavorite as renameFavoriteRecord,
  resolveNavigationForCurrentUser,
} from './navigationService'
import { resolveNavTarget } from './navTargetRoute'
import { useFavoriteContext } from './useFavoriteContext'

const HOME_ICON = 'pi pi-home'
const FAVORITES_ICON = 'pi pi-star'
const FOLDER_ICON = 'pi pi-folder'

const TARGET_ICONS: Record<NavTarget['kind'], string> = {
  object: 'pi pi-table',
  dashboard: 'pi pi-chart-bar',
  reports: 'pi pi-list',
  projects: 'pi pi-sitemap',
  url: 'pi pi-link',
  home: HOME_ICON,
}

export function useNavigationMenu() {
  const router = useRouter()
  const route = useRoute()
  const { t } = useTranslation()
  const { context } = useFavoriteContext()

  const app = shallowRef<NavigationApp | null>(null)
  const favorites = ref<NavLink[]>([])
  const menuItems = shallowRef<MenuItem[]>([])
  const loading = ref(false)

  // Prompt state surfaced to AppSidebar via return value.
  const promptVisible = ref(false)
  const promptInitialLabel = ref('')
  const promptTarget = ref<NavTarget>({ kind: 'home' })

  function navigate(target: NavTarget, homeTarget?: NavTarget): void {
    const resolved = resolveNavTarget(target, homeTarget)
    if (resolved.href) {
      window.open(resolved.href, '_blank', 'noopener')
      return
    }
    if (resolved.to) {
      void router.push(resolved.to)
    }
  }

  function linkToMenuItem(
    link: NavLink,
    homeTarget: NavTarget,
    favoriteId?: string,
  ): MenuItem {
    const menuItem: MenuItem = {
      key: link.id,
      label: link.label,
      icon: link.icon || TARGET_ICONS[link.target.kind],
      command: (event) => {
        event.originalEvent?.preventDefault?.()
        navigate(link.target, homeTarget)
      },
    }
    const resolved = resolveNavTarget(link.target, homeTarget)
    if (resolved.to) {
      ;(menuItem as MenuItem & { navTo?: RouteLocationRaw }).navTo = resolved.to
    }
    if (favoriteId) {
      ;(menuItem as MenuItem & { favoriteId: string }).favoriteId = favoriteId
    }
    return menuItem
  }

  function itemToMenuItem(item: NavItem, homeTarget: NavTarget): MenuItem {
    if (item.type === 'folder') {
      return {
        key: item.id,
        label: item.label,
        icon: item.icon || FOLDER_ICON,
        items: item.children.map((child) => itemToMenuItem(child, homeTarget)),
      }
    }
    return linkToMenuItem(item, homeTarget)
  }

  function buildMenu(): void {
    const current = app.value
    const homeTarget: NavTarget = current?.home ?? { kind: 'home' }

    const homeItem: MenuItem = {
      key: '__home__',
      label: t('navigation.home', 'Home'),
      icon: HOME_ICON,
      command: (event) => {
        event.originalEvent?.preventDefault?.()
        navigate({ kind: 'home' }, homeTarget)
      },
    }
    const homeResolved = resolveNavTarget({ kind: 'home' }, homeTarget)
    if (homeResolved.to) {
      ;(homeItem as MenuItem & { navTo?: RouteLocationRaw }).navTo = homeResolved.to
    }

    const favoritesItem: MenuItem = {
      key: '__favorites__',
      label: t('navigation.favorites', 'Favorites'),
      icon: FAVORITES_ICON,
      items: favorites.value.length
        ? favorites.value.map((link) => linkToMenuItem(link, homeTarget, link.id))
        : [
            {
              key: '__favorites_empty__',
              label: t('navigation.favoritesEmpty', 'No favorites yet'),
              disabled: true,
            },
          ],
    }

    menuItems.value = [
      homeItem,
      favoritesItem,
      ...(current?.items ?? []).map((item) => itemToMenuItem(item, homeTarget)),
    ]
  }

  async function reload(): Promise<void> {
    loading.value = true
    try {
      const [resolvedApp, favoritesResult] = await Promise.all([
        resolveNavigationForCurrentUser(),
        loadFavorites(),
      ])
      app.value = resolvedApp
      favorites.value = favoritesResult.items
      buildMenu()
    } catch {
      app.value = null
      favorites.value = []
      menuItems.value = []
    } finally {
      loading.value = false
    }
  }

  async function removeFavoriteById(favoriteId: string): Promise<void> {
    const result = await removeFavoriteRecord(favoriteId)
    favorites.value = result.items
    buildMenu()
  }

  async function renameFavoriteById(favoriteId: string, label: string): Promise<void> {
    const result = await renameFavoriteRecord(favoriteId, label)
    favorites.value = result.items
    buildMenu()
  }

  /**
   * Opens the label prompt pre-filled from the current page's context.
   * AppSidebar listens to promptVisible and calls confirmAddFavorite on OK.
   */
  function requestAddFavorite(): void {
    const ctx = context.value

    if (ctx) {
      promptInitialLabel.value = ctx.defaultLabel
      promptTarget.value = ctx.target
    } else {
      // Fallback: use the current route path as a generic URL target.
      const metaTitle = (route.meta as Record<string, unknown>).title
      promptInitialLabel.value =
        (typeof metaTitle === 'string' && metaTitle) ||
        (typeof route.name === 'string' && route.name) ||
        route.fullPath
      promptTarget.value = { kind: 'url', href: route.fullPath, external: false }
    }

    promptVisible.value = true
  }

  async function confirmAddFavorite(label: string): Promise<void> {
    const result = await addFavoriteRecord({ label, target: promptTarget.value })
    favorites.value = result.items
    buildMenu()
  }

  function goHome(): void {
    navigate({ kind: 'home' }, app.value?.home)
  }

  return {
    app,
    favorites,
    menuItems,
    loading,
    promptVisible,
    promptInitialLabel,
    reload,
    removeFavoriteById,
    renameFavoriteById,
    requestAddFavorite,
    confirmAddFavorite,
    goHome,
  }
}
