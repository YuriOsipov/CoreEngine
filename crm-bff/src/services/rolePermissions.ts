import { query, withTransaction } from '../db/pool.js'
import { PASSWORD_CHANGE_REQUIRED } from '../auth/accessGuards.js'
import { fetchMe, type MeUser } from '../adapters/usersAdapter.js'
import { REGISTRY_PLATFORM_ENTITIES } from '../schema/platformEntities.js'

// Permission checks currently hit Postgres several times (role resolve + flags).
// Cache per-request / short TTL later if this becomes hot.

export type PermissionAction = 'create' | 'read' | 'update' | 'delete' | 'import' | 'export'

/**
 * Objects hidden from the role permission matrix (platform + internal app
 * collections that are not day-to-day CRM CRUD targets).
 */
export const ROLE_PERMISSION_EXCLUDED_ENTITIES = new Set<string>([
  ...REGISTRY_PLATFORM_ENTITIES,
  'doc_template',
  'doc_template_snapshot',
  'doc_value',
  'doc_value_set',
  'languages',
])

function excludedEntityNames(): string[] {
  return [...ROLE_PERMISSION_EXCLUDED_ENTITIES]
}

export interface RolePermissionRow {
  entityApiName: string
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
  canImport: boolean
  canExport: boolean
}

export interface RolePermissionInput {
  entityApiName: string
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
  canImport: boolean
  canExport: boolean
}

/** Resolve app_roles.id from me.roleId (backend_role_id or uuid). */
export async function resolveAppRoleId(
  roleRef: string | null | undefined,
): Promise<string | null> {
  const raw = String(roleRef || '').trim()
  if (!raw) return null
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id
     FROM public.app_roles
     WHERE backend_role_id = $1 OR id::text = $1
     LIMIT 1`,
    [raw],
  )
  return rows[0]?.id ?? null
}

export async function listRolePermissions(
  roleId: string,
): Promise<RolePermissionRow[]> {
  const appRoleId = await resolveAppRoleId(roleId)
  if (!appRoleId) return []

  const rows = await query<{
    entity_api_name: string
    can_create: boolean
    can_read: boolean
    can_update: boolean
    can_delete: boolean
    can_import: boolean
    can_export: boolean
  }>(
    `SELECT entity_api_name, can_create, can_read, can_update, can_delete,
            can_import, can_export
     FROM public.role_permissions
     WHERE role_id = $1::uuid
     ORDER BY entity_api_name ASC`,
    [appRoleId],
  )

  return rows.map((row) => ({
    entityApiName: row.entity_api_name,
    canCreate: Boolean(row.can_create),
    canRead: Boolean(row.can_read),
    canUpdate: Boolean(row.can_update),
    canDelete: Boolean(row.can_delete),
    canImport: Boolean(row.can_import),
    canExport: Boolean(row.can_export),
  }))
}

/** Replace all permissions for a role (full matrix upsert). */
export async function replaceRolePermissions(
  roleId: string,
  permissions: RolePermissionInput[],
): Promise<RolePermissionRow[]> {
  const appRoleId = await resolveAppRoleId(roleId)
  if (!appRoleId) throw new Error(`Role not found: ${roleId}`)

  const cleaned = permissions
    .map((row) => ({
      entityApiName: String(row.entityApiName || '').trim(),
      canCreate: Boolean(row.canCreate),
      canRead: Boolean(row.canRead),
      canUpdate: Boolean(row.canUpdate),
      canDelete: Boolean(row.canDelete),
      canImport: Boolean(row.canImport),
      canExport: Boolean(row.canExport),
    }))
    .filter(
      (row) =>
        row.entityApiName && !ROLE_PERMISSION_EXCLUDED_ENTITIES.has(row.entityApiName),
    )

  const excluded = excludedEntityNames()
  await withTransaction(async (tx) => {
    await tx(
      `DELETE FROM public.role_permissions
       WHERE role_id = $1::uuid
         AND NOT (entity_api_name = ANY($2::text[]))`,
      [appRoleId, excluded],
    )

    for (const row of cleaned) {
      // Skip empty rows (no access) — absence means deny.
      if (
        !row.canCreate &&
        !row.canRead &&
        !row.canUpdate &&
        !row.canDelete &&
        !row.canImport &&
        !row.canExport
      ) {
        continue
      }
      await tx(
        `INSERT INTO public.role_permissions (
           role_id, entity_api_name, can_create, can_read, can_update, can_delete,
           can_import, can_export
         ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)`,
        [
          appRoleId,
          row.entityApiName,
          row.canCreate,
          row.canRead,
          row.canUpdate,
          row.canDelete,
          row.canImport,
          row.canExport,
        ],
      )
    }
  })

  return listRolePermissions(appRoleId)
}

/** Seed full CRUD for every non-platform entity (used when creating a role). */
export async function seedFullPermissionsForRole(roleId: string): Promise<void> {
  const appRoleId = await resolveAppRoleId(roleId)
  if (!appRoleId) return
  const excluded = excludedEntityNames()
  await query(
    `INSERT INTO public.role_permissions (
       role_id, entity_api_name, can_create, can_read, can_update, can_delete,
       can_import, can_export
     )
     SELECT $1::uuid, e.api_name, true, true, true, true, true, true
     FROM public.entities e
     WHERE e.deleted_at IS NULL
       AND upper(COALESCE(e.backend_target, '')) <> 'PLATFORM'
       AND NOT (e.api_name = ANY($2::text[]))
       AND COALESCE((e.backend_config->>'internal')::boolean, false) = false
     ON CONFLICT (role_id, entity_api_name) DO NOTHING`,
    [appRoleId, excluded],
  )
}

export async function isRoleAdmin(roleRef: string | null | undefined): Promise<boolean> {
  const raw = String(roleRef || '').trim()
  if (!raw) return false
  const rows = await query<{ is_admin: boolean }>(
    `SELECT COALESCE(is_admin, false) AS is_admin
     FROM public.app_roles
     WHERE backend_role_id = $1 OR id::text = $1
     LIMIT 1`,
    [raw],
  )
  return Boolean(rows[0]?.is_admin)
}

async function loadPermissionFlags(
  appRoleId: string,
  entityApiName: string,
): Promise<{
  canCreate: boolean
  canRead: boolean
  canUpdate: boolean
  canDelete: boolean
  canImport: boolean
  canExport: boolean
} | null> {
  const rows = await query<{
    can_create: boolean
    can_read: boolean
    can_update: boolean
    can_delete: boolean
    can_import: boolean
    can_export: boolean
  }>(
    `SELECT can_create, can_read, can_update, can_delete, can_import, can_export
     FROM public.role_permissions
     WHERE role_id = $1::uuid AND entity_api_name = $2
     LIMIT 1`,
    [appRoleId, entityApiName],
  )
  const row = rows[0]
  if (!row) return null
  return {
    canCreate: Boolean(row.can_create),
    canRead: Boolean(row.can_read),
    canUpdate: Boolean(row.can_update),
    canDelete: Boolean(row.can_delete),
    canImport: Boolean(row.can_import),
    canExport: Boolean(row.can_export),
  }
}

/**
 * Enforce collection CRUD for an already-verified user (no JWT re-fetch).
 * Admins bypass. Matrix-excluded collections (docs, Setting, user_setting, …)
 * are **admin-only** — no authenticated read bypass (avoids leaking generated
 * document payloads / org settings). users/roles remain authenticated-read for
 * pickers. File bytes / metadata use parent ACL (`fileAccess.ts`) or an
 * explicit matrix row — never a blanket authenticated `files` browse.
 * Missing permission row = deny. Admin flags must come from `fetchMe` / DB.
 */
export async function assertMeEntityPermission(
  me: MeUser | null | undefined,
  entityApiName: string,
  action: PermissionAction,
): Promise<MeUser> {
  const entity = String(entityApiName || '').trim()
  if (!entity) throw new Error('entity is required')
  if (!me?.id) {
    throw new Error(`Permission denied: ${action} on ${entity}`)
  }
  // Forced password change applies to everyone (including admins) until cleared.
  if (me.mustChangePassword) {
    throw new Error(PASSWORD_CHANGE_REQUIRED)
  }
  // roleAdminAccess is loaded from app_roles.is_admin in postgresFetchMe —
  // no second isRoleAdmin query needed here.
  if (me.adminAccess || me.roleAdminAccess) return me

  // Platform / document / settings objects: admin only (all actions).
  if (ROLE_PERMISSION_EXCLUDED_ENTITIES.has(entity)) {
    throw new Error(`Permission denied: ${action} on ${entity}`)
  }

  // Picker assets: authenticated read only for users/roles (writes need matrix).
  // `files` is intentionally excluded — list/browse needs matrix can_read or
  // dedicated assertFileReadable / recordFiles (parent) paths.
  if (action === 'read' && (entity === 'users' || entity === 'roles')) {
    return me
  }

  const appRoleId = await resolveAppRoleId(me.roleId)
  if (!appRoleId) {
    throw new Error(`Permission denied: ${action} on ${entity}`)
  }

  const flags = await loadPermissionFlags(appRoleId, entity)
  const allowed = flags
    ? action === 'create'
      ? flags.canCreate
      : action === 'read'
        ? flags.canRead
        : action === 'update'
          ? flags.canUpdate
          : action === 'delete'
            ? flags.canDelete
            : action === 'import'
              ? flags.canImport
              : flags.canExport
    : false

  if (!allowed) {
    throw new Error(`Permission denied: ${action} on ${entity}`)
  }
  return me
}

/**
 * Entities whose records `me` may read, or null when unrestricted (admin).
 * Mirrors assertMeEntityPermission: matrix can_read rows + picker assets.
 */
export async function readableEntityNames(me: MeUser): Promise<Set<string> | null> {
  if (me.adminAccess || me.roleAdminAccess) return null
  const out = new Set<string>(['users', 'roles'])
  const appRoleId = await resolveAppRoleId(me.roleId)
  if (!appRoleId) return out
  const rows = await query<{ entity_api_name: string }>(
    `SELECT entity_api_name
     FROM public.role_permissions
     WHERE role_id = $1::uuid AND can_read = true`,
    [appRoleId],
  )
  for (const row of rows) {
    if (!ROLE_PERMISSION_EXCLUDED_ENTITIES.has(row.entity_api_name)) {
      out.add(row.entity_api_name)
    }
  }
  return out
}

/**
 * Schema visibility for non-admins: readable entities plus the metadata of
 * entities they reference (M2O targets need display templates / pickers).
 * Returns null when unrestricted (admin).
 */
export async function visibleSchemaEntityNames(me: MeUser): Promise<Set<string> | null> {
  const readable = await readableEntityNames(me)
  if (!readable) return null
  const related = await query<{ api_name: string }>(
    `SELECT DISTINCT target.api_name
     FROM public.relations r
     JOIN public.entities src ON src.id = r.entity_id
     JOIN public.entities target
       ON target.id = r.related_entity_id OR target.id = r.junction_entity_id
       OR target.id = ANY(COALESCE(r.allowed_entity_ids, '{}'::uuid[]))
     WHERE src.api_name = ANY($1::text[])
       AND src.deleted_at IS NULL
       AND target.deleted_at IS NULL
       AND upper(COALESCE(target.backend_target, '')) <> 'PLATFORM'
       AND COALESCE((target.backend_config->>'internal')::boolean, false) = false
       AND NOT (target.api_name = ANY($2::text[]))`,
    [[...readable], excludedEntityNames()],
  )
  const visible = new Set(readable)
  for (const row of related) visible.add(row.api_name)
  return visible
}

/**
 * Enforce collection CRUD for the authenticated user.
 * Admins bypass. Missing permission row = deny.
 */
export async function assertEntityPermission(
  ctx: { authorization: string | null } | undefined,
  entityApiName: string,
  action: PermissionAction,
): Promise<MeUser> {
  const me = await fetchMe({ authorization: ctx?.authorization ?? null })
  return assertMeEntityPermission(me, entityApiName, action)
}

/** Entities list for permission matrix UI (excludes PLATFORM / system objects). */
export async function listPermissionEntities(): Promise<
  Array<{ apiName: string; label: string; hidden: boolean }>
> {
  const excluded = excludedEntityNames()
  const rows = await query<{
    api_name: string
    label: string
    hidden: boolean
  }>(
    `SELECT api_name, label, hidden
     FROM public.entities
     WHERE deleted_at IS NULL
       AND upper(COALESCE(backend_target, '')) <> 'PLATFORM'
       AND NOT (api_name = ANY($1::text[]))
       AND COALESCE((backend_config->>'internal')::boolean, false) = false
     ORDER BY label ASC, api_name ASC`,
    [excluded],
  )
  return rows.map((row) => ({
    apiName: row.api_name,
    label: row.label,
    hidden: Boolean(row.hidden),
  }))
}
