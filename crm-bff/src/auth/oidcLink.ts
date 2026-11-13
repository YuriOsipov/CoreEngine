import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import type { OidcIdClaims } from './oidcIdToken.js'
import {
  isOidcEmailDomainAllowed,
  readOidcConfig,
} from './oidcConfig.js'

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

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === '23505',
  )
}

const LINKED_USER_SELECT = `SELECT u.id::text AS id,
            u.backend_user_id,
            u.email,
            u.is_active,
            r.backend_role_id AS role_backend_id,
            COALESCE(r.is_admin, false) AS is_admin,
            c.password_hash,
            COALESCE(c.must_change_password, false) AS must_change_password
     FROM public.app_users u
     LEFT JOIN public.app_roles r ON r.id = u.role_id
     LEFT JOIN public.app_user_credentials c ON c.user_id = u.id`

async function loadLinkedUserById(userId: string): Promise<LinkedAuthUser | null> {
  const rows = await query<LinkedAuthUser>(
    LINKED_USER_SELECT + ' WHERE u.id = $1::uuid LIMIT 1',
    [userId],
  )
  return rows[0] ?? null
}

async function loadLinkedUserBySubject(
  issuer: string,
  subject: string,
): Promise<LinkedAuthUser | null> {
  const rows = await query<LinkedAuthUser>(
    LINKED_USER_SELECT +
      ' WHERE u.oidc_issuer = $1 AND u.oidc_subject = $2 LIMIT 1',
    [issuer, subject],
  )
  return rows[0] ?? null
}

async function loadLinkedUserByEmail(email: string): Promise<LinkedAuthUser | null> {
  const rows = await query<LinkedAuthUser>(
    LINKED_USER_SELECT + ' WHERE lower(u.email) = lower($1) LIMIT 1',
    [email],
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

function rejectDomain(email: string): {
  ok: false
  status: number
  error: string
} | null {
  const cfg = readOidcConfig()
  if (isOidcEmailDomainAllowed(email, cfg.allowedEmailDomains)) return null
  return {
    ok: false,
    status: 403,
    error: 'SSO email domain is not allowed',
  }
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
  return loadLinkedUserById(userId)
}

/**
 * Resolve or create app_users from verified OIDC id_token claims.
 * Prefer (issuer, sub); else link by verified email (non-admin); else optional JIT.
 */
export async function resolveUserFromOidcClaims(
  claims: OidcIdClaims,
): Promise<
  | { ok: true; user: LinkedAuthUser }
  | { ok: false; status: number; error: string }
> {
  const bySubject = await loadLinkedUserBySubject(claims.iss, claims.sub)
  if (bySubject) {
    if (!bySubject.is_active) {
      return { ok: false, status: 403, error: 'Account is inactive' }
    }
    return { ok: true, user: bySubject }
  }

  const domainReject = rejectDomain(claims.email)
  if (domainReject) return domainReject

  const byEmail = await loadLinkedUserByEmail(claims.email)
  if (byEmail) {
    if (!byEmail.is_active) {
      return { ok: false, status: 403, error: 'Account is inactive' }
    }
    // Email takeover is only safe with a positively verified IdP email claim.
    if (!claims.emailVerified) {
      return {
        ok: false,
        status: 403,
        error: 'SSO email is not verified; cannot link by email',
      }
    }
    // Admin accounts must be linked by pre-set oidc_issuer/subject — never by email.
    if (byEmail.is_admin) {
      return {
        ok: false,
        status: 403,
        error:
          'Admin accounts cannot be linked by email. An operator must set oidc_issuer and oidc_subject on the user.',
      }
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
    const refreshed = await loadLinkedUserById(byEmail.id)
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

  if (!claims.emailVerified) {
    return {
      ok: false,
      status: 403,
      error: 'SSO email is not verified; cannot provision account',
    }
  }

  try {
    const created = await createJitUser(claims)
    if (!created || !created.is_active) {
      return { ok: false, status: 500, error: 'SSO provisioning failed' }
    }
    return { ok: true, user: created }
  } catch (error) {
    // Concurrent first logins can race the unique email / oidc subject indexes.
    if (isUniqueViolation(error)) {
      const raced =
        (await loadLinkedUserBySubject(claims.iss, claims.sub)) ||
        (await loadLinkedUserByEmail(claims.email))
      if (raced?.is_active) {
        return { ok: true, user: raced }
      }
      if (raced && !raced.is_active) {
        return { ok: false, status: 403, error: 'Account is inactive' }
      }
    }
    const message = error instanceof Error ? error.message : 'SSO provisioning failed'
    return { ok: false, status: 500, error: message }
  }
}
