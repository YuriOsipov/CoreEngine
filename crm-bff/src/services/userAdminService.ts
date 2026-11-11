import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import {
  invalidateAccessTokensForUser,
  revokeAllRefreshTokensForUser,
} from '../auth/localAuth.js'
import { hashPassword, passwordPolicyError } from '../auth/passwords.js'
import { seedFullPermissionsForRole } from './rolePermissions.js'

export interface AppRoleAdmin {
  id: string
  name: string
  isAdmin: boolean
  backendRoleId: string | null
  userCount: number
}

export interface AppUserAdmin {
  id: string
  backendUserId: string | null
  email: string | null
  firstName: string | null
  lastName: string | null
  roleId: string | null
  roleName: string | null
  isActive: boolean
  hasPassword: boolean
}

export interface CreateAppRoleInput {
  name: string
  isAdmin?: boolean | null
}

export interface UpdateAppRoleInput {
  name?: string | null
  isAdmin?: boolean | null
}

export interface CreateAppUserInput {
  email: string
  firstName?: string | null
  lastName?: string | null
  roleId?: string | null
  password?: string | null
  isActive?: boolean | null
}

export interface UpdateAppUserInput {
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  roleId?: string | null
  isActive?: boolean | null
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function normalizeName(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

export async function listAppRolesAdmin(): Promise<AppRoleAdmin[]> {
  const rows = await query<{
    id: string
    name: string
    is_admin: boolean
    backend_role_id: string | null
    user_count: string
  }>(
    `SELECT
       r.id::text AS id,
       r.name,
       COALESCE(r.is_admin, false) AS is_admin,
       r.backend_role_id,
       COUNT(u.id)::text AS user_count
     FROM public.app_roles r
     LEFT JOIN public.app_users u ON u.role_id = r.id
     GROUP BY r.id
     ORDER BY r.name ASC`,
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isAdmin: Boolean(row.is_admin),
    backendRoleId: row.backend_role_id,
    userCount: Number(row.user_count || 0),
  }))
}

export async function createAppRole(input: CreateAppRoleInput): Promise<AppRoleAdmin> {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('Role name is required')
  const isAdmin = Boolean(input.isAdmin)
  const id = randomUUID()

  await query(
    `INSERT INTO public.app_roles (id, name, is_admin, backend_role_id)
     VALUES ($1::uuid, $2, $3, $4)`,
    [id, name, isAdmin, id],
  )
  await seedFullPermissionsForRole(id)

  const roles = await listAppRolesAdmin()
  const created = roles.find((role) => role.id === id)
  if (!created) throw new Error('Failed to create role')
  return created
}

export async function updateAppRole(
  id: string,
  input: UpdateAppRoleInput,
): Promise<AppRoleAdmin> {
  const roleId = String(id || '').trim()
  if (!roleId) throw new Error('Role id is required')

  const existing = await query<{ id: string; name: string; is_admin: boolean }>(
    `SELECT id::text AS id, name, COALESCE(is_admin, false) AS is_admin
     FROM public.app_roles WHERE id = $1::uuid LIMIT 1`,
    [roleId],
  )
  if (!existing[0]) throw new Error(`Role not found: ${roleId}`)

  const nextName =
    input.name !== undefined && input.name !== null
      ? String(input.name).trim()
      : existing[0].name
  if (!nextName) throw new Error('Role name is required')
  const nextAdmin =
    input.isAdmin !== undefined && input.isAdmin !== null
      ? Boolean(input.isAdmin)
      : Boolean(existing[0].is_admin)

  await query(
    `UPDATE public.app_roles
     SET name = $2,
         is_admin = $3,
         backend_role_id = COALESCE(backend_role_id, id::text),
         updated_at = now()
     WHERE id = $1::uuid`,
    [roleId, nextName, nextAdmin],
  )

  const roles = await listAppRolesAdmin()
  const updated = roles.find((role) => role.id === roleId)
  if (!updated) throw new Error(`Role not found after update: ${roleId}`)
  return updated
}

export async function deleteAppRole(id: string): Promise<boolean> {
  const roleId = String(id || '').trim()
  if (!roleId) throw new Error('Role id is required')

  const [{ count } = { count: '0' }] = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM public.app_users WHERE role_id = $1::uuid`,
    [roleId],
  )
  if (Number(count) > 0) {
    throw new Error('Cannot delete a role that still has users assigned')
  }

  const rows = await query<{ id: string }>(
    `DELETE FROM public.app_roles WHERE id = $1::uuid RETURNING id::text AS id`,
    [roleId],
  )
  return rows.length > 0
}

export async function listAppUsersAdmin(options?: {
  search?: string | null
  includeInactive?: boolean | null
}): Promise<AppUserAdmin[]> {
  const search = options?.search?.trim() || ''
  const includeInactive = options?.includeInactive !== false
  const where: string[] = ['TRUE']
  const params: unknown[] = []
  let next = 1

  if (!includeInactive) {
    where.push('u.is_active = true')
  }
  if (search) {
    where.push(
      `(u.first_name ILIKE $${next} OR u.last_name ILIKE $${next} OR u.email ILIKE $${next})`,
    )
    params.push(`%${search}%`)
    next += 1
  }

  const rows = await query<{
    id: string
    backend_user_id: string | null
    email: string | null
    first_name: string | null
    last_name: string | null
    role_id: string | null
    role_name: string | null
    is_active: boolean
    has_password: boolean
  }>(
    `SELECT
       u.id::text AS id,
       u.backend_user_id,
       u.email,
       u.first_name,
       u.last_name,
       u.role_id::text AS role_id,
       r.name AS role_name,
       u.is_active,
       (c.user_id IS NOT NULL) AS has_password
     FROM public.app_users u
     LEFT JOIN public.app_roles r ON r.id = u.role_id
     LEFT JOIN public.app_user_credentials c ON c.user_id = u.id
     WHERE ${where.join(' AND ')}
     ORDER BY u.first_name NULLS LAST, u.last_name NULLS LAST, u.email NULLS LAST`,
    params,
  )

  return rows.map((row) => ({
    id: row.id,
    backendUserId: row.backend_user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    roleId: row.role_id,
    roleName: row.role_name,
    isActive: Boolean(row.is_active),
    hasPassword: Boolean(row.has_password),
  }))
}

async function assertRoleExists(roleId: string | null): Promise<void> {
  if (!roleId) return
  const rows = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.app_roles WHERE id = $1::uuid LIMIT 1`,
    [roleId],
  )
  if (!rows[0]) throw new Error(`Role not found: ${roleId}`)
}

async function assertEmailAvailable(
  email: string,
  exceptUserId?: string,
): Promise<void> {
  const rows = await query<{ id: string }>(
    exceptUserId
      ? `SELECT id::text AS id FROM public.app_users
         WHERE lower(email) = lower($1) AND id <> $2::uuid LIMIT 1`
      : `SELECT id::text AS id FROM public.app_users
         WHERE lower(email) = lower($1) LIMIT 1`,
    exceptUserId ? [email, exceptUserId] : [email],
  )
  if (rows[0]) throw new Error(`Email already in use: ${email}`)
}

export async function createAppUser(input: CreateAppUserInput): Promise<AppUserAdmin> {
  const email = normalizeEmail(String(input.email || ''))
  if (!email) throw new Error('Email is required')
  await assertEmailAvailable(email)

  const roleId = input.roleId ? String(input.roleId).trim() : null
  await assertRoleExists(roleId)

  const id = randomUUID()
  const backendUserId = id
  const firstName = normalizeName(input.firstName)
  const lastName = normalizeName(input.lastName)
  const isActive = input.isActive !== false

  await query(
    `INSERT INTO public.app_users (
       id, auth_user_id, email, first_name, last_name, role_id, backend_user_id, is_active
     ) VALUES ($1::uuid, NULL, $2, $3, $4, $5::uuid, $6, $7)`,
    [id, email, firstName, lastName, roleId, backendUserId, isActive],
  )

  const password = input.password?.trim()
  if (password) {
    const policyError = passwordPolicyError(password)
    if (policyError) throw new Error(policyError)
    const passwordHash = await hashPassword(password)
    // Admin-chosen password is known to the admin — user must replace it at first login.
    await query(
      `INSERT INTO public.app_user_credentials (user_id, password_hash, must_change_password)
       VALUES ($1::uuid, $2, true)`,
      [id, passwordHash],
    )
  }

  const users = await listAppUsersAdmin({ includeInactive: true })
  const created = users.find((user) => user.id === id)
  if (!created) throw new Error('Failed to create user')
  return created
}

export async function updateAppUser(
  id: string,
  input: UpdateAppUserInput,
): Promise<AppUserAdmin> {
  const userId = String(id || '').trim()
  if (!userId) throw new Error('User id is required')

  const existing = await query<{
    id: string
    email: string | null
    first_name: string | null
    last_name: string | null
    role_id: string | null
    is_active: boolean
  }>(
    `SELECT id::text AS id, email, first_name, last_name, role_id::text AS role_id, is_active
     FROM public.app_users WHERE id = $1::uuid LIMIT 1`,
    [userId],
  )
  if (!existing[0]) throw new Error(`User not found: ${userId}`)

  const nextEmail =
    input.email !== undefined && input.email !== null
      ? normalizeEmail(String(input.email))
      : existing[0].email
  if (!nextEmail) throw new Error('Email is required')
  await assertEmailAvailable(nextEmail, userId)

  const nextRoleId =
    input.roleId === undefined
      ? existing[0].role_id
      : input.roleId === null || String(input.roleId).trim() === ''
        ? null
        : String(input.roleId).trim()
  await assertRoleExists(nextRoleId)

  const nextFirst =
    input.firstName !== undefined
      ? normalizeName(input.firstName)
      : existing[0].first_name
  const nextLast =
    input.lastName !== undefined
      ? normalizeName(input.lastName)
      : existing[0].last_name
  const nextActive =
    input.isActive !== undefined && input.isActive !== null
      ? Boolean(input.isActive)
      : Boolean(existing[0].is_active)

  await query(
    `UPDATE public.app_users
     SET email = $2,
         first_name = $3,
         last_name = $4,
         role_id = $5::uuid,
         is_active = $6,
         updated_at = now()
     WHERE id = $1::uuid`,
    [userId, nextEmail, nextFirst, nextLast, nextRoleId, nextActive],
  )

  const users = await listAppUsersAdmin({ includeInactive: true })
  const updated = users.find((user) => user.id === userId)
  if (!updated) throw new Error(`User not found after update: ${userId}`)
  return updated
}

export async function setAppUserPassword(
  id: string,
  password: string,
): Promise<boolean> {
  const userId = String(id || '').trim()
  const nextPassword = String(password || '')
  if (!userId) throw new Error('User id is required')
  const policyError = passwordPolicyError(nextPassword)
  if (policyError) throw new Error(policyError)

  const existing = await query<{ id: string }>(
    `SELECT id::text AS id FROM public.app_users WHERE id = $1::uuid LIMIT 1`,
    [userId],
  )
  if (!existing[0]) throw new Error(`User not found: ${userId}`)

  const passwordHash = await hashPassword(nextPassword)
  await query(
    `INSERT INTO public.app_user_credentials (user_id, password_hash, must_change_password)
     VALUES ($1::uuid, $2, true)
     ON CONFLICT (user_id) DO UPDATE
     SET password_hash = EXCLUDED.password_hash,
         must_change_password = true,
         updated_at = now()`,
    [userId, passwordHash],
  )
  await revokeAllRefreshTokensForUser(userId)
  await invalidateAccessTokensForUser(userId)
  return true
}
