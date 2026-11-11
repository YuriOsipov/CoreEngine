import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import { ACCESS_TTL_SEC, REFRESH_TTL_SEC, signAccessToken } from './jwt.js'
import { isInsecurePassword } from './insecurePasswords.js'
import { hashPassword, verifyPassword } from './passwords.js'

export interface AuthSessionPayload {
  access_token: string
  expires: number
  refresh_token: string
  must_change_password?: boolean
}

interface AuthUserRow {
  id: string
  backend_user_id: string | null
  email: string | null
  is_active: boolean
  role_backend_id: string | null
  is_admin: boolean | null
  password_hash: string | null
  must_change_password: boolean
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function loadUserByEmail(email: string): Promise<AuthUserRow | null> {
  const rows = await query<AuthUserRow>(
    `SELECT u.id::text AS id,
            u.backend_user_id,
            u.email,
            u.is_active,
            r.backend_role_id AS role_backend_id,
            COALESCE(r.is_admin, false) AS is_admin,
            c.password_hash,
            COALESCE(c.must_change_password, false) AS must_change_password
     FROM public.app_users u
     LEFT JOIN public.app_roles r ON r.id = u.role_id
     LEFT JOIN public.app_user_credentials c ON c.user_id = u.id
     WHERE lower(u.email) = lower($1)
     LIMIT 1`,
    [email],
  )
  return rows[0] ?? null
}

async function loadUserById(id: string): Promise<AuthUserRow | null> {
  const rows = await query<AuthUserRow>(
    `SELECT u.id::text AS id,
            u.backend_user_id,
            u.email,
            u.is_active,
            r.backend_role_id AS role_backend_id,
            COALESCE(r.is_admin, false) AS is_admin,
            c.password_hash,
            COALESCE(c.must_change_password, false) AS must_change_password
     FROM public.app_users u
     LEFT JOIN public.app_roles r ON r.id = u.role_id
     LEFT JOIN public.app_user_credentials c ON c.user_id = u.id
     WHERE u.id::text = $1 OR u.backend_user_id = $1
     LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

/** Opaque refresh tokens (hashed in DB) — not JWTs; cannot pass verifyAccessToken. */
export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  const id = String(userId || '').trim()
  if (!id) return
  await query(`DELETE FROM public.app_refresh_tokens WHERE user_id = $1::uuid`, [id])
}

async function issueSession(user: AuthUserRow): Promise<AuthSessionPayload> {
  const subject = user.backend_user_id || user.id
  // Admin flags are not embedded — fetchMe / assert* read them from app_users.
  const accessToken = signAccessToken({
    id: subject,
    role: user.role_backend_id,
  })
  const refreshToken = randomBytes(32).toString('base64url')
  const tokenHash = hashRefreshToken(refreshToken)
  // Pass id from Node so INSERT does not invoke extensions.gen_random_uuid()
  // (pgcrypto.dll is blocked by WDAC on some Windows hosts).
  await query(
    `INSERT INTO public.app_refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1::uuid, $2::uuid, $3, now() + ($4::int * interval '1 second'))`,
    [randomUUID(), user.id, tokenHash, REFRESH_TTL_SEC],
  )
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires: ACCESS_TTL_SEC,
    ...(user.must_change_password ? { must_change_password: true } : {}),
  }
}

function refuseNonLocalAuth(mode: string): {
  ok: false
  status: number
  error: string
} {
  return {
    ok: false,
    status: 503,
    error: `AUTH_BACKEND=${mode} was retired. Use AUTH_BACKEND=local with app_user_credentials.`,
  }
}

export async function bffLogin(input: {
  email: string
  password: string
}): Promise<
  { ok: true; session: AuthSessionPayload } | { ok: false; status: number; error: string }
> {
  const mode = (process.env.AUTH_BACKEND || 'local').trim().toLowerCase()
  if (mode && mode !== 'local' && mode !== 'supabase' && mode !== 'postgres') {
    return refuseNonLocalAuth(mode)
  }

  const user = await loadUserByEmail(input.email)
  if (!user || !user.is_active || !user.password_hash) {
    return { ok: false, status: 401, error: 'Login failed' }
  }
  const ok = await verifyPassword(input.password, user.password_hash)
  if (!ok) return { ok: false, status: 401, error: 'Login failed' }
  return { ok: true, session: await issueSession(user) }
}

export async function bffRefresh(input: {
  refreshToken: string
}): Promise<
  { ok: true; session: AuthSessionPayload } | { ok: false; status: number; error: string }
> {
  const tokenHash = hashRefreshToken(input.refreshToken)
  const rows = await query<{ user_id: string }>(
    `DELETE FROM public.app_refresh_tokens
     WHERE token_hash = $1 AND expires_at > now()
     RETURNING user_id::text AS user_id`,
    [tokenHash],
  )
  const row = rows[0]
  if (!row?.user_id) return { ok: false, status: 401, error: 'Refresh failed' }
  const user = await loadUserById(row.user_id)
  if (!user || !user.is_active) {
    return { ok: false, status: 401, error: 'Refresh failed' }
  }
  return { ok: true, session: await issueSession(user) }
}

export async function bffLogout(input: {
  refreshToken: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const tokenHash = hashRefreshToken(input.refreshToken)
  await query(`DELETE FROM public.app_refresh_tokens WHERE token_hash = $1`, [tokenHash])
  return { ok: true }
}

/** @deprecated Password capture via hybrid login was retired. */
export async function hashPasswordForUser(
  userId: string,
  password: string,
  options?: { mustChangePassword?: boolean },
): Promise<void> {
  const passwordHash = await hashPassword(password)
  const mustChange =
    options?.mustChangePassword === true || isInsecurePassword(password)
  await query(
    `INSERT INTO public.app_user_credentials (user_id, password_hash, must_change_password)
     VALUES ($1::uuid, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       must_change_password = EXCLUDED.must_change_password,
       updated_at = now()`,
    [userId, passwordHash, mustChange],
  )
  await revokeAllRefreshTokensForUser(userId)
}

export async function bffChangePassword(input: {
  userId: string
  currentPassword: string
  newPassword: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const newPassword = input.newPassword.trim()
  if (newPassword.length < 8) {
    return { ok: false, status: 400, error: 'New password must be at least 8 characters' }
  }
  if (isInsecurePassword(newPassword)) {
    return {
      ok: false,
      status: 400,
      error: 'New password is a known insecure / example value — choose a unique password',
    }
  }

  const user = await loadUserById(input.userId)
  if (!user || !user.is_active || !user.password_hash) {
    return { ok: false, status: 401, error: 'Change password failed' }
  }
  const ok = await verifyPassword(input.currentPassword, user.password_hash)
  if (!ok) return { ok: false, status: 401, error: 'Current password is incorrect' }

  const passwordHash = await hashPassword(newPassword)
  await query(
    `UPDATE public.app_user_credentials
     SET password_hash = $2,
         must_change_password = false,
         updated_at = now()
     WHERE user_id = $1::uuid`,
    [user.id, passwordHash],
  )
  await revokeAllRefreshTokensForUser(user.id)
  return { ok: true }
}
