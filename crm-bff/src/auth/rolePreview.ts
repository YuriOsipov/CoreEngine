/**
 * Admin "View as role" preview for API enforcement.
 *
 * Real admins may send `X-Role-Preview: <app_role_id>` (or `__default_role__`).
 * Record / schema ACL then uses that role instead of admin bypass. GraphQL `me`
 * and Setup admin guards must not apply this — the session stays admin.
 */
import { query } from '../db/pool.js'
import type { MeUser } from '../adapters/usersAdapter.js'

export const ROLE_PREVIEW_HEADER = 'x-role-preview'
export const ROLE_PREVIEW_DEFAULT = '__default_role__'

export type AuthContextWithPreview = {
  authorization: string | null
  rolePreview?: string | null
}

export function readRolePreviewHeader(
  headers: Record<string, unknown> | undefined | null,
): string | null {
  if (!headers) return null
  const raw = headers[ROLE_PREVIEW_HEADER] ?? headers['X-Role-Preview']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function isAdmin(me: MeUser): boolean {
  return Boolean(me.adminAccess || me.roleAdminAccess)
}

async function loadPreviewRole(roleRef: string): Promise<{
  id: string
  isAdmin: boolean
} | null> {
  const rows = await query<{ id: string; is_admin: boolean }>(
    `SELECT id::text AS id, COALESCE(is_admin, false) AS is_admin
     FROM public.app_roles
     WHERE id::text = $1 OR backend_role_id = $1
     LIMIT 1`,
    [roleRef],
  )
  const row = rows[0]
  if (!row?.id) return null
  return { id: row.id, isAdmin: Boolean(row.is_admin) }
}

/**
 * Strip admin bypass and bind `roleId` to the previewed role.
 * Non-admins cannot escalate via the header (ignored).
 */
export async function applyRolePreview(
  me: MeUser,
  rolePreview: string | null | undefined,
): Promise<MeUser> {
  const raw = typeof rolePreview === 'string' ? rolePreview.trim() : ''
  if (!raw) return me
  if (!isAdmin(me)) return me

  if (raw === ROLE_PREVIEW_DEFAULT) {
    return {
      ...me,
      adminAccess: false,
      roleAdminAccess: false,
      roleId: null,
      roleName: null,
    }
  }

  const role = await loadPreviewRole(raw)
  if (!role) {
    throw new Error(`Invalid role preview: ${raw}`)
  }

  return {
    ...me,
    adminAccess: false,
    roleAdminAccess: role.isAdmin,
    roleId: role.id,
  }
}
