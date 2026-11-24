import type { MeUser } from '../adapters/usersAdapter.js'
import { resolveAppRoleId } from '../services/rolePermissions.js'

/** Row-scope for presets / dashboards / panels list queries. */
export type ListVisibility =
  | { kind: 'admin' }
  | { kind: 'scoped'; userId: string; roleRefs: string[] }

export function isAdminMe(me: MeUser): boolean {
  return Boolean(me.adminAccess || me.roleAdminAccess)
}

/** Admins see all rows; others get user + role refs (layoutSettings pattern). */
export async function resolveListVisibility(me: MeUser): Promise<ListVisibility> {
  if (isAdminMe(me)) return { kind: 'admin' }
  const appRoleId = await resolveAppRoleId(me.roleId)
  const roleRefs = [me.roleId, appRoleId]
    .map((ref) => (typeof ref === 'string' ? ref.trim() : ''))
    .filter(Boolean)
  const userId = typeof me.id === 'string' ? me.id.trim() : ''
  return { kind: 'scoped', userId, roleRefs }
}
