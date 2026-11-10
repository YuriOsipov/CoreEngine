import type { RouteLocationRaw } from 'vue-router'
import { canReadEntity, ensureEntityPermissions } from '@/core/entityPermissions'
import { resolveNavigationForCurrentUser } from './navigationService'
import { resolveNavTarget } from './navTargetRoute'

/**
 * Route for the current navigation app's configured Home landing.
 * Returns null when Home is left as the default Objects page (`/`).
 */
export async function resolveAppHomeRoute(): Promise<RouteLocationRaw | null> {
  const app = await resolveNavigationForCurrentUser()
  const home = app?.home
  if (!home || home.kind === 'home') return null

  if (home.kind === 'object') {
    await ensureEntityPermissions()
    if (!canReadEntity(home.collection)) return null
  }

  const resolved = resolveNavTarget({ kind: 'home' }, home)
  if (!resolved.to) return null

  if (isObjectsHomeRoute(resolved.to)) return null
  return resolved.to
}

function isObjectsHomeRoute(to: RouteLocationRaw): boolean {
  if (typeof to === 'string') {
    return to === '/' || to === ''
  }
  if ('name' in to && to.name === 'home') return true
  if ('path' in to && (to.path === '/' || to.path === '')) {
    const query = to.query
    if (!query || Object.keys(query).length === 0) return true
  }
  return false
}
