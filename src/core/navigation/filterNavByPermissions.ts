import type { NavItem, NavLink, NavigationApp, NavTarget } from '@/interfaces'
import {
  canReadEntity,
  ensureEntityPermissions,
} from '@/core/entityPermissions'

let accessibleReportIds: Set<string> | null = null

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
  if (target.kind === 'reports') {
    const ids = Array.isArray(target.reportIds) ? target.reportIds.map(String) : []
    if (ids.length === 0) return true
    if (!accessibleReportIds) return true
    return ids.some((id) => accessibleReportIds!.has(id))
  }
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

/** Drop object/report links (and empty folders) the effective role cannot access. */
export async function filterNavigationByReadAccess(
  app: NavigationApp | null,
  favorites: NavLink[] = [],
): Promise<{ app: NavigationApp | null; favorites: NavLink[] }> {
  await ensureEntityPermissions()
  try {
    const { listReportsForCurrentRole } = await import(
      '@/modules/reports/services/reportSettings'
    )
    const reports = await listReportsForCurrentRole()
    accessibleReportIds = new Set(reports.map((report) => String(report.settingId)))
  } catch {
    accessibleReportIds = null
  }

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
