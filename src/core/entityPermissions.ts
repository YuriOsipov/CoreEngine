import { computed, onMounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { currentUser, currentUserRole } from '@/core/currentUser'
import { getRolePreviewOverride } from '@/core/rolePreview'
import { fetchMyRolePermissions } from '@/core/graphql/entityPermissionsApi'
import { fetchAppRolesAdmin, fetchRolePermissions } from '@/core/graphql/userAdminApi'
import type { EntityPermissionDto } from '@/core/graphql/entityPermissionsApi'

export interface EntityPermissionFlags {
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
  canImport: boolean
  canExport: boolean
}

/**
 * Matches BFF matrix-excluded collections — admin/Setup only in UI.
 * users/roles/files stay authenticated-read for pickers.
 */
const PERMISSION_EXCLUDED_ENTITIES = new Set<string>([
  'setting',
  'user_setting',
  'recent_record_views',
  'doc_template',
  'doc_template_snapshot',
  'doc_value',
  'doc_value_set',
  'languages',
])

const PICKER_READ_ENTITIES = new Set(['users', 'roles', 'files'])

const READ_ONLY_ACCESS: EntityPermissionFlags = {
  canCreate: false,
  canRead: true,
  canUpdate: false,
  canDelete: false,
  canImport: false,
  canExport: false,
}

const FULL_ACCESS: EntityPermissionFlags = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
  canImport: true,
  canExport: true,
}

const NO_ACCESS: EntityPermissionFlags = {
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDelete: false,
  canImport: false,
  canExport: false,
}

let cache: Map<string, EntityPermissionFlags> | null = null
/** Identifies which effective role `cache` / `adminFullAccess` were loaded for. */
let cacheScopeKey: string | null = null
let adminFullAccess = false
let loadPromise: Promise<void> | null = null
let revision = 0

function normalizeCollection(collection: string | null | undefined): string {
  return String(collection || '')
    .trim()
    .toLowerCase()
}

function applyPermissionRows(rows: EntityPermissionDto[]): void {
  const next = new Map<string, EntityPermissionFlags>()
  for (const row of rows) {
    const key = normalizeCollection(row.entityApiName)
    if (!key) continue
    next.set(key, {
      canCreate: Boolean(row.canCreate),
      canRead: Boolean(row.canRead),
      canUpdate: Boolean(row.canUpdate),
      canDelete: Boolean(row.canDelete),
      canImport: Boolean(row.canImport),
      canExport: Boolean(row.canExport),
    })
  }
  cache = next
  adminFullAccess = false
}

export function clearEntityPermissionsCache(): void {
  cache = null
  cacheScopeKey = null
  adminFullAccess = false
  loadPromise = null
  revision += 1
}

function resolvePermissionScopeKey(
  userIsAdmin: boolean,
  previewOverride: string | null | undefined,
  ownRoleId: string | null,
): string {
  if (userIsAdmin) {
    if (previewOverride === undefined) return 'admin:full'
    if (previewOverride === null) return 'admin:default'
    return `admin:preview:${previewOverride}`
  }
  return `role:${ownRoleId || 'none'}`
}

async function isPreviewedRoleAdmin(roleId: string): Promise<boolean> {
  const raw = String(roleId || '').trim()
  if (!raw) return false
  try {
    const roles = await fetchAppRolesAdmin()
    // Preview selector stores backend_role_id; admin list uses app_roles.id.
    const matched = roles.find(
      (role) =>
        String(role.id) === raw ||
        (role.backendRoleId != null && String(role.backendRoleId) === raw),
    )
    if (matched) return Boolean(matched.isAdmin)
  } catch {
    // Fall through — treat as non-admin matrix.
  }
  return false
}

/**
 * Load CRUD flags for the effective role.
 * Admins without "View as role" get full access.
 * Admins previewing another role get that role's matrix (UI-only gate).
 */
export async function ensureEntityPermissions(): Promise<void> {
  if (loadPromise) return loadPromise

  const user = await currentUser()
  const previewOverride = user.isAdmin ? getRolePreviewOverride() : undefined
  const ownRoleId = user.isAdmin ? user.roleId : await currentUserRole()
  const scopeKey = resolvePermissionScopeKey(user.isAdmin, previewOverride, ownRoleId)

  if (cache && cacheScopeKey === scopeKey) return
  if (loadPromise) return loadPromise

  // Scope changed (e.g. role preview) — drop stale admin-full / matrix cache.
  if (cacheScopeKey !== scopeKey) {
    cache = null
    adminFullAccess = false
  }

  loadPromise = (async () => {
    try {
      // Real admin session, not previewing → full UI access.
      if (user.isAdmin && previewOverride === undefined) {
        adminFullAccess = true
        cache = new Map()
        cacheScopeKey = scopeKey
        return
      }

      // Admin previewing "Default (all roles)" → no specific matrix; deny writes.
      if (user.isAdmin && previewOverride === null) {
        adminFullAccess = false
        cache = new Map()
        cacheScopeKey = scopeKey
        return
      }

      // Admin previewing a concrete role → load that role's permissions.
      if (user.isAdmin && typeof previewOverride === 'string' && previewOverride) {
        if (await isPreviewedRoleAdmin(previewOverride)) {
          adminFullAccess = true
          cache = new Map()
          cacheScopeKey = scopeKey
          return
        }
        applyPermissionRows(await fetchRolePermissions(previewOverride))
        cacheScopeKey = scopeKey
        return
      }

      // Non-admin (or unexpected path): own role matrix from BFF.
      if (!ownRoleId) {
        adminFullAccess = false
        cache = new Map()
        cacheScopeKey = scopeKey
        return
      }
      applyPermissionRows(await fetchMyRolePermissions())
      cacheScopeKey = scopeKey
    } catch {
      cache = new Map()
      cacheScopeKey = scopeKey
      adminFullAccess = false
    } finally {
      loadPromise = null
      revision += 1
    }
  })()

  return loadPromise
}

export function getEntityPermission(
  collection: string | null | undefined,
): EntityPermissionFlags {
  const key = normalizeCollection(collection)
  if (!key) return NO_ACCESS
  if (PERMISSION_EXCLUDED_ENTITIES.has(key)) return NO_ACCESS
  if (PICKER_READ_ENTITIES.has(key)) return READ_ONLY_ACCESS
  if (adminFullAccess) return FULL_ACCESS
  if (!cache) return NO_ACCESS
  return cache.get(key) ?? NO_ACCESS
}

export function canCreateEntity(collection: string | null | undefined): boolean {
  return getEntityPermission(collection).canCreate
}

export function canReadEntity(collection: string | null | undefined): boolean {
  return getEntityPermission(collection).canRead
}

export function canUpdateEntity(collection: string | null | undefined): boolean {
  return getEntityPermission(collection).canUpdate
}

export function canDeleteEntity(collection: string | null | undefined): boolean {
  return getEntityPermission(collection).canDelete
}

export function canImportEntity(collection: string | null | undefined): boolean {
  return getEntityPermission(collection).canImport
}

export function canExportEntity(collection: string | null | undefined): boolean {
  return getEntityPermission(collection).canExport
}

/**
 * Reactive CRUD flags for a collection. Loads the role matrix once and refreshes
 * when the collection changes or the permission cache is cleared.
 */
export function useEntityPermissions(
  collection: MaybeRefOrGetter<string | null | undefined>,
) {
  const ready = ref(Boolean(cache) || adminFullAccess)
  const tick = ref(revision)

  async function refresh(): Promise<void> {
    await ensureEntityPermissions()
    tick.value = revision
    ready.value = true
  }

  onMounted(() => {
    void refresh()
  })

  // Load immediately in setup so list/related watches do not race ahead of onMounted.
  void refresh()

  watch(
    () => toValue(collection),
    () => {
      void refresh()
    },
  )

  const flags = computed(() => {
    void tick.value
    return getEntityPermission(toValue(collection))
  })

  return {
    ready,
    flags,
    canCreate: computed(() => flags.value.canCreate),
    canRead: computed(() => flags.value.canRead),
    canUpdate: computed(() => flags.value.canUpdate),
    canDelete: computed(() => flags.value.canDelete),
    canImport: computed(() => flags.value.canImport),
    canExport: computed(() => flags.value.canExport),
    refresh,
  }
}
