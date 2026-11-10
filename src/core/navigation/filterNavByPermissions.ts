import type { NavItem, NavLink, NavigationApp, NavTarget } from '@/interfaces'
import {
  canReadEntity,
  ensureEntityPermissions,
} from '@/core/entityPermissions'

function objectCollectionFromTarget(target: NavTarget): string | null {
  if (target.kind === 'object') {
    const collection = String(target.collection || '').trim()
    return collection || null
  }
  if (target.kind === 'url' && !target.external && typeof target.href === 'string') {
    const match = target.href.match(/^\/object\/([^/?#]+)/i)
    if (!match?.[1]) return null
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
  return null
}

function canAccessNavTarget(target: NavTarget): boolean {
  const collection = objectCollectionFromTarget(target)
  if (!collection) return true
  return canReadEntity(collection)
}

function filterNavItems(items: NavItem[]): NavItem[] {
  const next: NavItem[] = []
  for (const item of items) {
    if (item.type === 'folder') {
      const children = filterNavItems(item.children)
      if (children.length === 0) continue
      next.push({ ...item, children })
      continue
    }
    if (!canAccessNavTarget(item.target)) continue
    next.push(item)
  }
  return next
}

function filterFavoriteLinks(items: NavLink[]): NavLink[] {
  return items.filter((item) => canAccessNavTarget(item.target))
}

/** Drop object links (and empty folders) the effective role cannot read. */
export async function filterNavigationByReadAccess(
  app: NavigationApp | null,
  favorites: NavLink[] = [],
): Promise<{ app: NavigationApp | null; favorites: NavLink[] }> {
  await ensureEntityPermissions()
  if (!app) {
    return { app: null, favorites: filterFavoriteLinks(favorites) }
  }
  return {
    app: {
      ...app,
      items: filterNavItems(app.items ?? []),
    },
    favorites: filterFavoriteLinks(favorites),
  }
}
