import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import type { OidcIdClaims } from './oidcIdToken.js'
import { readOidcConfig } from './oidcConfig.js'

export interface LinkedAuthUser {
  id: string
  backend_user_id: string | null
  email: string | null
  is_active: boolean
  role_backend_id: string | null
  is_admin: boolean | null
  password_hash: string | null
  must_change_password: boolean
}

async function loadLinkedUser(whereSql: string, params: unknown[]): Promise<LinkedAuthUser | null> {
  const rows = await query<LinkedAuthUser>(
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
     WHERE ${whereSql}
     LIMIT 1`,
    params,
  )
  return rows[0] ?? null
}

async function linkOidcFields(
  userId: string,
  issuer: string,
  subject: string,
): Promise<void> {
  await query(
    `UPDATE public.app_users
     SET oidc_issuer = $2,
         oidc_subject = $3,
         updated_at = now()
     WHERE id = $1::uuid`,
    [userId, issuer, subject],
  )
}

async function createJitUser(claims: OidcIdClaims): Promise<LinkedAuthUser | null> {
  const cfg = readOidcConfig()
  if (!cfg.jitProvision || !cfg.defaultRoleBackendId) return null

  const roleRows = await query<{ id: string }>(
    `SELECT id::text AS id
     FROM public.app_roles
     WHERE backend_role_id = $1
     LIMIT 1`,
    [cfg.defaultRoleBackendId],
  )
  const roleId = roleRows[0]?.id
  if (!roleId) {
    throw new Error(
      `OIDC JIT: role backend_role_id=${cfg.defaultRoleBackendId} not found`,
    )
  }

  const userId = randomUUID()
  const backendUserId = `oidc:${claims.sub}`
  await query(
    `INSERT INTO public.app_users (
       id, email, first_name, last_name, role_id, backend_user_id,
       oidc_issuer, oidc_subject, is_active
     ) VALUES (
       $1::uuid, $2, $3, $4, $5::uuid, $6, $7, $8, true
     )`,
    [
      userId,
      claims.email,
      claims.givenName,
      claims.familyName,
      roleId,
      backendUserId,
      claims.iss,
      claims.sub,
    ],
  )
  return loadLinkedUser('u.id = $1::uuid', [userId])
}

/**
 * Resolve or create app_users from verified OIDC id_token claims.
 * Prefer (issuer, sub); else link by verified email; else optional JIT.
 */
export async function resolveUserFromOidcClaims(
  claims: OidcIdClaims,
): Promise<
  | { ok: true; user: LinkedAuthUser }
  | { ok: false; status: number; error: string }
> {
  const bySubject = await loadLinkedUser(
    'u.oidc_issuer = $1 AND u.oidc_subject = $2',
    [claims.iss, claims.sub],
  )
  if (bySubject) {
    if (!bySubject.is_active) {
      return { ok: false, status: 403, error: 'Account is inactive' }
    }
    return { ok: true, user: bySubject }
  }

  const byEmail = await loadLinkedUser('lower(u.email) = lower($1)', [claims.email])
  if (byEmail) {
    if (!byEmail.is_active) {
      return { ok: false, status: 403, error: 'Account is inactive' }
    }
    // Do not steal an account already linked to a different IdP subject.
    const existingLink = await query<{ oidc_subject: string | null }>(
      `SELECT oidc_subject FROM public.app_users WHERE id = $1::uuid`,
      [byEmail.id],
    )
    const linkedSub = existingLink[0]?.oidc_subject
    if (linkedSub && linkedSub !== claims.sub) {
      return {
        ok: false,
        status: 403,
        error: 'Email is already linked to another SSO identity',
      }
    }
    await linkOidcFields(byEmail.id, claims.iss, claims.sub)
    const refreshed = await loadLinkedUser('u.id = $1::uuid', [byEmail.id])
    if (!refreshed) {
      return { ok: false, status: 500, error: 'SSO link failed' }
    }
    return { ok: true, user: refreshed }
  }

  const cfg = readOidcConfig()
  if (!cfg.jitProvision) {
    return {
      ok: false,
      status: 403,
      error: 'No CoreEngine user for this SSO identity. Ask an admin to provision your account.',
    }
  }

  try {
    const created = await createJitUser(claims)
    if (!created || !created.is_active) {
      return { ok: false, status: 500, error: 'SSO provisioning failed' }
    }
    return { ok: true, user: created }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SSO provisioning failed'
    return { ok: false, status: 500, error: message }
  }
}
