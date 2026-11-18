/**
 * Role resolution for `scripts/seed-n8n-automation-user.mts`.
 * Default: non-admin Integration with full object CRUD (not FLS bypass).
 */
import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import { seedFullPermissionsForRole } from '../services/rolePermissions.js'

export type N8nAutomationRole = {
  id: string
  name: string
  isAdmin: boolean
}

export async function resolveN8nAutomationRole(options: {
  wantAdmin?: boolean
  roleName?: string | null
  dryRun?: boolean
}): Promise<N8nAutomationRole> {
  const wantAdmin = options.wantAdmin === true
  const dryRun = options.dryRun === true
  const preferredName =
    String(options.roleName || 'Integration').trim() || 'Integration'

  if (wantAdmin) {
    const adminRoles = await query<{ id: string; name: string | null }>(
      `SELECT id::text AS id, name
       FROM public.app_roles
       WHERE is_admin = true
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
    )
    const adminRole = adminRoles[0]
    if (!adminRole) {
      throw new Error('No app_roles with is_admin=true — create an admin role first')
    }
    return {
      id: adminRole.id,
      name: adminRole.name || 'Administrator',
      isAdmin: true,
    }
  }

  const existing = await query<{
    id: string
    name: string | null
    is_admin: boolean
  }>(
    `SELECT id::text AS id, name, is_admin
     FROM public.app_roles
     WHERE lower(name) = lower($1)
     LIMIT 1`,
    [preferredName],
  )

  if (existing[0]) {
    if (existing[0].is_admin) {
      throw new Error(
        `Role "${preferredName}" is admin. Pass --admin to use it, or --role=<non-admin name>.`,
      )
    }
    if (!dryRun) {
      await seedFullPermissionsForRole(existing[0].id)
    }
    return {
      id: existing[0].id,
      name: existing[0].name || preferredName,
      isAdmin: false,
    }
  }

  if (dryRun) {
    return { id: 'dry-run-role', name: preferredName, isAdmin: false }
  }

  const id = randomUUID()
  await query(
    `INSERT INTO public.app_roles (id, name, is_admin, backend_role_id)
     VALUES ($1::uuid, $2, false, $3)`,
    [id, preferredName, id],
  )
  await seedFullPermissionsForRole(id)
  return { id, name: preferredName, isAdmin: false }
}
