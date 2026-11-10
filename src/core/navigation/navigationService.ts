import {
  readSettingRecord,
  readSettingRecords,
  writeSettingDelete,
  writeSettingUpsert,
} from '@/core/graphql/settingRecordsBridge'
import {
  readUserSettingBridge,
  upsertUserSettingBridge,
} from '@/core/graphql/userSettingsApi'
import { currentUserId, currentUserRole } from '@/core/currentUser'
import {
  parseSettingRoleId,
  parseSettingRoleName,
  sortRoleScopedLayouts,
} from '@/core/settingRoleUtils'
import type {
  NavFolder,
  NavItem,
  NavLink,
  NavTarget,
  NavigationApp,
  NavigationFavorites,
  SavedNavigationApp,
} from '@/interfaces'
import { NAV_MAX_DEPTH } from '@/interfaces'
import { legacyFilterNameToViewId } from './navTargetRoute'

/** Namespace tag stored in the `collection` field to group all navigation rows. */
export const NAV_NAMESPACE = 'crm_navigation'
const GROUP_APP = 'app'
const SUB_GROUP = 'full'
const APP_VERSION = 1

/** Per-user favorites live in the dedicated `user_setting` collection. */
const FAVORITES_GROUP = 'favorites'
const FAVORITES_KEY = 'items'

interface NavSettingRecord {
  id: number | string
  collection: string
  group: string
  name?: string | null
  sub_group: string
  role?: string | { id?: string | number; name?: string | null } | null
  body?: NavigationApp | string | null
}

export interface SaveNavigationAppOptions {
  /** Underlying Setting record id when updating an existing app. */
  recordId?: string | null
  name: string
  roleId: string | null
  isDefault: boolean
}

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function createDefaultNavTarget(): NavTarget {
  return { kind: 'home' }
}

export function createDefaultNavigationApp(name = ''): NavigationApp {
  return {
    id: genId('nav'),
    name,
    label: name,
    isDefault: false,
    version: APP_VERSION,
    home: createDefaultNavTarget(),
    items: [],
  }
}

function parseBody<T>(body: NavSettingRecord['body']): T | null {
  if (!body) return null
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as T
    } catch {
      return null
    }
  }
  return body as unknown as T
}

function normalizeTarget(target: unknown): NavTarget {
  const value = (target && typeof target === 'object' ? target : {}) as Record<string, unknown>
  switch (value.kind) {
    case 'object': {
      const collection = String(value.collection ?? '')
      const viewId =
        typeof value.viewId === 'string' && value.viewId
          ? value.viewId
          : typeof value.filterName === 'string'
            ? legacyFilterNameToViewId(value.filterName)
            : undefined
      const filterName =
        !viewId && typeof value.filterName === 'string' && value.filterName
          ? value.filterName
          : undefined
      return {
        kind: 'object',
        collection,
        ...(viewId ? { viewId } : {}),
        ...(filterName ? { filterName } : {}),
      }
    }
    case 'dashboard':
      return { kind: 'dashboard', dashboardId: String(value.dashboardId ?? '') }
    case 'reports':
      return {
        kind: 'reports',
        reportIds: Array.isArray(value.reportIds)
          ? value.reportIds.map((id) => String(id)).filter(Boolean)
          : [],
      }
    case 'projects':
      return {
        kind: 'projects',
        ...(typeof value.patientId === 'string' && value.patientId
          ? { patientId: value.patientId }
          : {}),
      }
    case 'url':
      return {
        kind: 'url',
        href: String(value.href ?? ''),
        external: value.external === true,
      }
    case 'home':
    default:
      return { kind: 'home' }
  }
}

/** Recursively normalizes items, enforcing max depth and dropping duplicate ids (cycle guard). */
function normalizeItems(
  items: unknown,
  depth: number,
  seen: Set<string>,
): NavItem[] {
  if (!Array.isArray(items) || depth > NAV_MAX_DEPTH) return []

  const result: NavItem[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const value = raw as Record<string, unknown>
    const id = typeof value.id === 'string' && value.id ? value.id : genId('navitem')
    if (seen.has(id)) continue
    seen.add(id)

    if (value.type === 'folder') {
      const folder: NavFolder = {
        id,
        type: 'folder',
        label: String(value.label ?? ''),
        ...(typeof value.icon === 'string' && value.icon ? { icon: value.icon } : {}),
        collapsed: value.collapsed === true,
        children: normalizeItems(value.children, depth + 1, seen),
      }
      result.push(folder)
      continue
    }

    const link: NavLink = {
      id,
      type: 'link',
      label: String(value.label ?? ''),
      ...(typeof value.icon === 'string' && value.icon ? { icon: value.icon } : {}),
      target: normalizeTarget(value.target),
    }
    result.push(link)
  }

  return result
}

export function normalizeNavigationApp(
  app: Partial<NavigationApp> | null | undefined,
): NavigationApp {
  const base = createDefaultNavigationApp()
  if (!app) return base

  return {
    id: typeof app.id === 'string' && app.id ? app.id : base.id,
    name: String(app.name ?? ''),
    label: String(app.label ?? app.name ?? ''),
    ...(typeof app.icon === 'string' && app.icon ? { icon: app.icon } : {}),
    isDefault: app.isDefault === true,
    version: typeof app.version === 'number' ? app.version : APP_VERSION,
    home: normalizeTarget(app.home),
    items: normalizeItems(app.items, 1, new Set<string>()),
  }
}

function toSavedNavigationApp(record: NavSettingRecord): SavedNavigationApp {
  const body = normalizeNavigationApp(parseBody<NavigationApp>(record.body))
  return {
    id: String(record.id),
    name: record.name?.trim() || body.name || String(record.id),
    label: body.label || record.name?.trim() || String(record.id),
    roleId: parseSettingRoleId(record.role),
    roleName: parseSettingRoleName(record.role),
    isDefault: body.isDefault === true,
  }
}

async function readAppRecords(roleId?: string | null): Promise<NavSettingRecord[]> {
  return readSettingRecords<NavSettingRecord>({
    collection: NAV_NAMESPACE,
    groups: [GROUP_APP],
    subGroup: SUB_GROUP,
    ...(roleId !== undefined ? { roleId } : {}),
  })
}

async function readAppRecordById(recordId: string): Promise<NavSettingRecord | null> {
  return readSettingRecord<NavSettingRecord>({
    collection: NAV_NAMESPACE,
    groups: [GROUP_APP],
    id: recordId,
  })
}

/** Lists all navigation apps across roles (designer selector). */
export async function loadNavigationApps(): Promise<SavedNavigationApp[]> {
  const records = await readAppRecords(undefined)
  const saved = records.map(toSavedNavigationApp)
  return sortRoleScopedLayouts(
    saved.map((app) => ({ id: app.id, name: app.name, roleId: app.roleId, roleName: app.roleName })),
  ).map((sorted) => saved.find((app) => app.id === sorted.id) as SavedNavigationApp)
}

export async function loadNavigationAppById(recordId: string): Promise<NavigationApp | null> {
  const record = await readAppRecordById(recordId)
  if (!record) return null
  return normalizeNavigationApp(parseBody<NavigationApp>(record.body))
}

/** Clears the default flag on every other app owned by the same role. */
async function clearOtherDefaults(roleId: string | null, keepRecordId: string): Promise<void> {
  const records = await readAppRecords(roleId)
  await Promise.all(
    records
      .filter((record) => String(record.id) !== keepRecordId)
      .map(async (record) => {
        const body = normalizeNavigationApp(parseBody<NavigationApp>(record.body))
        if (!body.isDefault) return
        const nextBody = { ...body, isDefault: false }
        await writeSettingUpsert({
          settingId: String(record.id),
          entityApiName: NAV_NAMESPACE,
          groupKey: GROUP_APP,
          subGroup: SUB_GROUP,
          roleId: parseSettingRoleId(record.role),
          name: record.name ?? body.name,
          body: nextBody as unknown as Record<string, unknown>,
        })
      }),
  )
}

export async function saveNavigationApp(
  app: NavigationApp,
  options: SaveNavigationAppOptions,
): Promise<SavedNavigationApp> {
  const name = options.name.trim()
  if (!name) {
    throw new Error('Navigation app name is required')
  }

  const roleId = options.roleId ?? null
  const body: NavigationApp = {
    ...normalizeNavigationApp(app),
    name,
    label: app.label?.trim() || name,
    isDefault: options.isDefault,
  }
  const existing = options.recordId ? await readAppRecordById(String(options.recordId)) : null
  const savedId = await writeSettingUpsert({
    settingId: existing ? String(existing.id) : null,
    entityApiName: NAV_NAMESPACE,
    groupKey: GROUP_APP,
    subGroup: SUB_GROUP,
    roleId,
    name,
    body: body as unknown as Record<string, unknown>,
  })

  if (options.isDefault) {
    await clearOtherDefaults(roleId, savedId)
  }

  return {
    id: savedId,
    name,
    label: body.label,
    roleId,
    isDefault: options.isDefault,
  }
}

export async function deleteNavigationApp(recordId: string): Promise<void> {
  const existing = await readAppRecordById(recordId)
  if (!existing) return
  await writeSettingDelete(String(existing.id))
}

/**
 * Resolves the navigation app to show for a role: role-scoped default →
 * role-scoped first → global (null role) default → global first.
 */
export async function resolveNavigationForRole(
  roleId: string | null,
): Promise<NavigationApp | null> {
  const pick = (records: NavSettingRecord[]): NavSettingRecord | null => {
    if (records.length === 0) return null
    const withDefault = records.find(
      (record) => normalizeNavigationApp(parseBody<NavigationApp>(record.body)).isDefault,
    )
    return withDefault ?? records[0]
  }

  let record = roleId ? pick(await readAppRecords(roleId)) : null
  if (!record) {
    record = pick(await readAppRecords(null))
  }
  if (!record) return null

  return normalizeNavigationApp(parseBody<NavigationApp>(record.body))
}

export async function resolveNavigationForCurrentUser(): Promise<NavigationApp | null> {
  const roleId = await currentUserRole()
  return resolveNavigationForRole(roleId)
}

interface UserSettingRecord {
  id: number | string
  value?: unknown
}

async function readFavoritesRecord(userId: string): Promise<UserSettingRecord | null> {
  const value = await readUserSettingBridge({
    userId,
    collection: NAV_NAMESPACE,
    groupKey: FAVORITES_GROUP,
    key: FAVORITES_KEY,
  })
  if (value === null || value === undefined) return null
  return { id: 'bridge', value }
}

function parseFavoritesValue(value: unknown): Partial<NavigationFavorites> | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return { items: value as NavLink[] }
  if (typeof value === 'object') return value as Partial<NavigationFavorites>
  return null
}

function normalizeFavorites(
  favorites: Partial<NavigationFavorites> | null | undefined,
): NavigationFavorites {
  const items = normalizeItems(favorites?.items, 1, new Set<string>()).filter(
    (item): item is NavLink => item.type === 'link',
  ).map((item) => ({
    ...item,
    target: normalizeFavoriteTarget(item.target),
  }))
  return { items }
}

/**
 * Favorites are consumed from the sidebar where path-based routing is the most
 * stable behavior across PanelMenu interactions. Convert object-list links into
 * internal URL targets at the storage boundary.
 */
function normalizeFavoriteTarget(target: NavTarget): NavTarget {
  if (target.kind !== 'object') return target

  if (target.viewId) {
    return {
      kind: 'url',
      href: `/object/${encodeURIComponent(target.collection)}/view/${encodeURIComponent(target.viewId)}`,
      external: false,
    }
  }

  if (target.filterName) {
    return {
      kind: 'url',
      href: `/object/${encodeURIComponent(target.collection)}/filter/${encodeURIComponent(target.filterName)}`,
      external: false,
    }
  }

  return {
    kind: 'url',
    href: `/object/${encodeURIComponent(target.collection)}`,
    external: false,
  }
}

export async function loadFavorites(): Promise<NavigationFavorites> {
  const userId = await currentUserId()
  if (!userId) return { items: [] }
  const record = await readFavoritesRecord(userId)
  return normalizeFavorites(parseFavoritesValue(record?.value))
}

export async function saveFavorites(
  favorites: NavigationFavorites,
): Promise<NavigationFavorites> {
  const userId = await currentUserId()
  if (!userId) throw new Error('Cannot save favorites without a signed-in user')

  const body = normalizeFavorites(favorites)

  await upsertUserSettingBridge({
    userId,
    collection: NAV_NAMESPACE,
    groupKey: FAVORITES_GROUP,
    key: FAVORITES_KEY,
    value: body.items,
  })
  return body
}

export async function addFavorite(link: Omit<NavLink, 'id' | 'type'>): Promise<NavigationFavorites> {
  const favorites = await loadFavorites()
  const target = normalizeFavoriteTarget(normalizeTarget(link.target))
  const signature = JSON.stringify(target)
  const existingIndex = favorites.items.findIndex(
    (item) => JSON.stringify(item.target) === signature,
  )

  if (existingIndex !== -1) {
    // Update label on duplicate instead of silently ignoring.
    const updated = favorites.items.map((item, index) =>
      index === existingIndex ? { ...item, label: link.label } : item,
    )
    return saveFavorites({ items: updated })
  }

  const next: NavigationFavorites = {
    items: [
      ...favorites.items,
      {
        id: genId('fav'),
        type: 'link',
        label: link.label,
        ...(link.icon ? { icon: link.icon } : {}),
        target,
      },
    ],
  }
  return saveFavorites(next)
}

export async function renameFavorite(
  favoriteId: string,
  label: string,
): Promise<NavigationFavorites> {
  const favorites = await loadFavorites()
  const updated = favorites.items.map((item) =>
    item.id === favoriteId ? { ...item, label: label.trim() || item.label } : item,
  )
  return saveFavorites({ items: updated })
}

export async function removeFavorite(favoriteId: string): Promise<NavigationFavorites> {
  const favorites = await loadFavorites()
  return saveFavorites({
    items: favorites.items.filter((item) => item.id !== favoriteId),
  })
}
