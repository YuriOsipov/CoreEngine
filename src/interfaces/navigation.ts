/**
 * Role-scoped navigation ("apps") — Salesforce-style navigation systems.
 * Persisted in the generic `Setting` collection under collection `crm_navigation`.
 */

export type NavTargetKind = 'object' | 'dashboard' | 'reports' | 'projects' | 'url' | 'home'

/** Opens the Project Management module. */
export interface NavProjectsTarget {
  kind: 'projects'
  /** Optional patient filter deep-link. */
  patientId?: string
}

/** Opens an entity object list, optionally a saved filter view. */
export interface NavObjectTarget {
  kind: 'object'
  collection: string
  /** Optional saved list view ID resolved by the object list route. */
  viewId?: string
  /** @deprecated Use viewId instead. */
  filterName?: string
}

/** Opens exactly one dashboard. */
export interface NavDashboardTarget {
  kind: 'dashboard'
  dashboardId: string
}

/** Opens a curated list of reports (by Setting record id). */
export interface NavReportsTarget {
  kind: 'reports'
  reportIds: string[]
}

/** Opens an internal route or external URL. */
export interface NavUrlTarget {
  kind: 'url'
  href: string
  external?: boolean
}

/** Resolves to the app's configured Home landing target. */
export interface NavHomeTarget {
  kind: 'home'
}

export type NavTarget =
  | NavObjectTarget
  | NavDashboardTarget
  | NavReportsTarget
  | NavProjectsTarget
  | NavUrlTarget
  | NavHomeTarget

/** A leaf navigation entry that routes somewhere. */
export interface NavLink {
  id: string
  type: 'link'
  label: string
  icon?: string
  target: NavTarget
}

/** A container that can nest links and further folders (recursive). */
export interface NavFolder {
  id: string
  type: 'folder'
  label: string
  icon?: string
  collapsed?: boolean
  children: NavItem[]
}

export type NavItem = NavFolder | NavLink

/** A full navigation system assigned to a role. */
export interface NavigationApp {
  id: string
  /** Internal machine name. */
  name: string
  /** Display label. */
  label: string
  icon?: string
  /** Default landing app for the owning role. */
  isDefault?: boolean
  version: number
  /** What the fixed "Home" folder resolves to for this app. */
  home: NavTarget
  /** Admin-designed tree (Home and Favorites are injected at render time). */
  items: NavItem[]
}

/** Lightweight descriptor used by the designer selector. */
export interface SavedNavigationApp {
  /** Underlying Setting record id. */
  id: string
  name: string
  label: string
  roleId: string | null
  roleName?: string | null
  isDefault: boolean
}

/** Per-user favorites payload stored against the user id. */
export interface NavigationFavorites {
  items: NavLink[]
}

/** Maximum folder nesting depth enforced by the designer/runtime guards. */
export const NAV_MAX_DEPTH = 5
