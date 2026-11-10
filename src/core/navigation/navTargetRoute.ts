import type { RouteLocationRaw } from 'vue-router'
import type { NavTarget } from '@/interfaces'
import { ALL_RECORDS_FILTER_ID, ALL_RECORDS_FILTER } from '@/modules/config/services/listFilterSettings'
import { RECENTLY_VIEWED_FILTER_ID, RECENTLY_VIEWED_FILTER } from '@/modules/dashboard/services/recentRecords'

/** Landing route used when a Home target is left unresolved. */
export const NAV_HOME_FALLBACK: RouteLocationRaw = { path: '/' }

export interface ResolvedNavTarget {
  /** In-app router location, when the target navigates internally. */
  to?: RouteLocationRaw
  /** External URL, when the target opens a new tab. */
  href?: string
}

/** Maps legacy object favorites that stored a display name to a view id. */
export function legacyFilterNameToViewId(filterName: string | undefined): string | undefined {
  if (!filterName) return undefined
  if (filterName === ALL_RECORDS_FILTER_ID || filterName === ALL_RECORDS_FILTER.name) {
    return ALL_RECORDS_FILTER_ID
  }
  if (filterName === RECENTLY_VIEWED_FILTER_ID || filterName === RECENTLY_VIEWED_FILTER.name) {
    return RECENTLY_VIEWED_FILTER_ID
  }
  return undefined
}

/**
 * Converts a raw href into an internal router path when possible.
 * This keeps legacy favorites that stored absolute same-origin URLs
 * in SPA navigation mode instead of triggering a full page reload.
 */
function toInternalPath(href: string): string | null {
  const value = href.trim()
  if (!value) return null

  // Relative app paths (legacy or current payloads).
  if (value.startsWith('/')) return value
  if (value.startsWith('./')) return value.slice(1)

  // Absolute URL: treat same-origin as internal, others as external.
  try {
    const parsed = new URL(value, window.location.origin)
    if (parsed.origin !== window.location.origin) return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    // Fallback: plain segment like "object/visit/filter/x"
    return value.startsWith('object/') ? `/${value}` : value
  }
}

/** Normalize a path/fullPath for favorite ↔ current-page comparison. */
export function normalizeFavoriteRouteKey(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return '/'
  try {
    const parsed = new URL(trimmed, window.location.origin)
    const key = `${parsed.pathname}${parsed.search}`.replace(/\/+$/, '')
    return key || '/'
  } catch {
    const key = trimmed.split('#')[0]?.replace(/\/+$/, '') ?? ''
    return key || '/'
  }
}

/**
 * True when a favorite target resolves to the same in-app location as `fullPath`.
 */
export function favoriteTargetMatchesRoute(
  target: NavTarget,
  fullPath: string,
  homeTarget?: NavTarget,
  resolve: (to: RouteLocationRaw) => { fullPath: string } = (to) =>
    ({ fullPath: typeof to === 'string' ? to : String((to as { path?: string }).path ?? '/') }),
): boolean {
  const currentKey = normalizeFavoriteRouteKey(fullPath)
  const resolved = resolveNavTarget(target, homeTarget)
  if (resolved.to) {
    try {
      return normalizeFavoriteRouteKey(resolve(resolved.to).fullPath) === currentKey
    } catch {
      return false
    }
  }
  if (resolved.href) {
    const internal = toInternalPath(resolved.href)
    return internal ? normalizeFavoriteRouteKey(internal) === currentKey : false
  }
  return false
}

/**
 * Maps a navigation target to a router location (or external href).
 * `homeTarget` resolves the fixed Home entry to the app's configured landing.
 */
export function resolveNavTarget(
  target: NavTarget,
  homeTarget?: NavTarget,
): ResolvedNavTarget {
  switch (target.kind) {
    case 'object': {
      const viewId = target.viewId ?? legacyFilterNameToViewId(target.filterName)
      if (viewId) {
        return {
          to: { name: 'object-list-filter', params: { collection: target.collection, filter_id: viewId } },
        }
      }
      return {
        to: target.filterName
          ? {
              name: 'object-list-filter-name',
              params: { collection: target.collection, filterName: target.filterName },
            }
          : { name: 'object-list', params: { collection: target.collection } },
      }
    }
    case 'dashboard':
      return { to: { path: '/dashboards', query: { id: target.dashboardId } } }
    case 'reports':
      return {
        to: {
          path: '/reports',
          query: target.reportIds.length ? { ids: target.reportIds.join(',') } : {},
        },
      }
    case 'projects':
      return {
        to: {
          path: '/object/pm_project',
          query: target.patientId ? { patient: target.patientId } : {},
        },
      }
    case 'url':
      if (target.external) return { href: target.href }
      {
        const internalPath = toInternalPath(target.href)
        return internalPath ? { to: { path: internalPath } } : { href: target.href }
      }
    case 'home':
    default:
      if (homeTarget && homeTarget.kind !== 'home') {
        return resolveNavTarget(homeTarget)
      }
      return { to: NAV_HOME_FALLBACK }
  }
}
