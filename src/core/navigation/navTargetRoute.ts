import type { RouteLocationRaw } from 'vue-router'
import type { NavTarget } from '@/interfaces'

/** Landing route used when a Home target is left unresolved. */
export const NAV_HOME_FALLBACK: RouteLocationRaw = { path: '/' }

export interface ResolvedNavTarget {
  /** In-app router location, when the target navigates internally. */
  to?: RouteLocationRaw
  /** External URL, when the target opens a new tab. */
  href?: string
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

/**
 * Maps a navigation target to a router location (or external href).
 * `homeTarget` resolves the fixed Home entry to the app's configured landing.
 */
export function resolveNavTarget(
  target: NavTarget,
  homeTarget?: NavTarget,
): ResolvedNavTarget {
  switch (target.kind) {
    case 'object':
      if (target.viewId) {
        return {
          to: { name: 'object-list-filter', params: { collection: target.collection, filter_id: target.viewId } },
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
