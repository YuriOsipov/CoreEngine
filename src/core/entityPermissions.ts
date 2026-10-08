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
}

/** Matches BFF ROLE_PERMISSION_EXCLUDED_ENTITIES — not gated by the role matrix. */
const PERMISSION_EXCLUDED_ENTITIES = new Set<string>([
  'doc_template',
  'doc_template_snapshot',
  'doc_value',
  'doc_value_set',
  'languages',
  'users',
  'roles',
  'files',
])

const FULL_ACCESS: EntityPermissionFlags = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: true,
}

const NO_ACCESS: EntityPermissionFlags = {
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDelete: false,
}

let cache: Map<string, EntityPermissionFlags> | null = null
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
    })
  }
  cache = next
  adminFullAccess = false
}

export function clearEntityPermissionsCache(): void {
  cache = null
  adminFullAccess = false
  loadPromise = null
  revision += 1
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
  if (cache) return
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    try {
      const user = await currentUser()
      const previewOverride = user.isAdmin ? getRolePreviewOverride() : undefined

      // Real admin session, not previewing → full UI access.
      if (user.isAdmin && previewOverride === undefined) {
        adminFullAccess = true
        cache = new Map()
        return
      }

      // Admin previewing "Default (all roles)" → no specific matrix; deny writes.
      if (user.isAdmin && previewOverride === null) {
        adminFullAccess = false
        cache = new Map()
        return
      }

      // Admin previewing a concrete role → load that role's permissions.
      if (user.isAdmin && typeof previewOverride === 'string' && previewOverride) {
        if (await isPreviewedRoleAdmin(previewOverride)) {
          adminFullAccess = true
          cache = new Map()
          return
        }
        applyPermissionRows(await fetchRolePermissions(previewOverride))
        return
      }

      // Non-admin (or unexpected path): own role matrix from BFF.
      const roleId = await currentUserRole()
      if (!roleId) {
        adminFullAccess = false
        cache = new Map()
        return
      }
      applyPermissionRows(await fetchMyRolePermissions())
    } catch {
      cache = new Map()
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
  if (PERMISSION_EXCLUDED_ENTITIES.has(key)) return FULL_ACCESS
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
    refresh,
  }
}
