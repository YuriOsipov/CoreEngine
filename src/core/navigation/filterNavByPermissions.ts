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
  // Report ACL is enforced on the Reports page. Keep nav links so folders
  // configured in Setup stay visible even when a report id is stale/role-scoped.
  if (target.kind === 'reports') return true

  const collection = objectCollectionFromTarget(target)
  if (!collection) return true
  return canReadEntity(collection)
}

/** Soft-trim inaccessible report ids; keep the link even if none remain. */
function refineNavTarget(target: NavTarget): NavTarget {
  if (target.kind !== 'reports' || !accessibleReportIds) return target
  const ids = Array.isArray(target.reportIds) ? target.reportIds.map(String) : []
  if (ids.length === 0) return target
  const nextIds = ids.filter((id) => accessibleReportIds!.has(id))
  // Prefer accessible subset; if none match, keep originals so the route still opens.
  return { ...target, reportIds: nextIds.length > 0 ? nextIds : ids }
}

function filterNavItems(items: NavItem[]): NavItem[] {
  const next: NavItem[] = []
  for (const item of items) {
    if (item.type === 'folder') {
      const children = filterNavItems(item.children)
      // Keep folders from Setup even when empty (e.g. newly added "rr").
      next.push({ ...item, children })
      continue
    }
    if (!canAccessNavTarget(item.target)) continue
    next.push({ ...item, target: refineNavTarget(item.target) })
  }
  return next
}

function filterFavoriteLinks(items: NavLink[]): NavLink[] {
  return items
    .filter((item) => canAccessNavTarget(item.target))
    .map((item) => ({ ...item, target: refineNavTarget(item.target) }))
}

/** Drop object links (and soft-trim report ids) the effective role cannot access. */
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
