import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'
import { ACCESS_TTL_SEC, REFRESH_TTL_SEC, signAccessToken, verifyAccessToken } from './jwt.js'
import { isInsecurePassword } from './insecurePasswords.js'
import {
  hashPassword,
  passwordNeedsRehash,
  passwordPolicyError,
  verifyAgainstDummyHash,
  verifyPassword,
} from './passwords.js'
import { oidcCheckOnRefreshEnabled } from './oidcSessionCheck.js'
import { openOidcToken, sealOidcToken } from './oidcTokenCrypto.js'

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

/** Reject every access token issued before now (password change / admin reset). */
export async function invalidateAccessTokensForUser(userId: string): Promise<void> {
  const id = String(userId || '').trim()
  if (!id) return
  await query(
    `UPDATE public.app_user_credentials
     SET tokens_valid_after = now()
     WHERE user_id = $1::uuid`,
    [id],
  )
}

/** Denylist one access token until its natural expiry (logout). */
export async function revokeAccessToken(token: string): Promise<void> {
  const claims = verifyAccessToken(token)
  if (!claims?.jti) return
  await query(
    `INSERT INTO public.app_revoked_access_tokens (jti, user_id, expires_at)
     SELECT $1, u.id, to_timestamp($3)
     FROM (SELECT 1) one
     LEFT JOIN public.app_users u ON u.backend_user_id = $2 OR u.id::text = $2
     ON CONFLICT (jti) DO NOTHING`,
    [claims.jti, claims.id, claims.exp],
  )
  await query(`DELETE FROM public.app_revoked_access_tokens WHERE expires_at < now()`)
}

export type IssueSessionOidcTokens = {
  accessToken?: string | null
  refreshToken?: string | null
}

/** Issue CoreEngine access + refresh after local login or OIDC bridge. */
export async function issueSession(
  user: {
    id: string
    backend_user_id: string | null
    role_backend_id: string | null
    must_change_password: boolean
  },
  options?: { oidc?: IssueSessionOidcTokens | null },
): Promise<AuthSessionPayload> {
  const subject = user.backend_user_id || user.id
  // Admin flags are not embedded — fetchMe / assert* read them from app_users.
  const accessToken = signAccessToken({
    id: subject,
    role: user.role_backend_id,
  })
  const refreshToken = randomBytes(32).toString('base64url')
  const tokenHash = hashRefreshToken(refreshToken)
  // Only persist IdP tokens when refresh-time userinfo checks are enabled.
  // Seal at rest so a DB/backup leak does not expose live IdP refresh tokens.
  let oidcAccess: string | null = null
  let oidcRefresh: string | null = null
  if (oidcCheckOnRefreshEnabled()) {
    oidcAccess = sealOidcToken(options?.oidc?.accessToken)
    oidcRefresh = sealOidcToken(options?.oidc?.refreshToken)
  }
  // Pass id from Node so INSERT does not invoke extensions.gen_random_uuid()
  // (pgcrypto.dll is blocked by WDAC on some Windows hosts).
  try {
    await query(
      `INSERT INTO public.app_refresh_tokens (
         id, user_id, token_hash, expires_at, oidc_access_token, oidc_refresh_token
       ) VALUES (
         $1::uuid, $2::uuid, $3, now() + ($4::int * interval '1 second'), $5, $6
       )`,
      [randomUUID(), user.id, tokenHash, REFRESH_TTL_SEC, oidcAccess, oidcRefresh],
    )
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== '42703') throw error
    if (oidcCheckOnRefreshEnabled() && (options?.oidc?.accessToken || options?.oidc?.refreshToken)) {
      throw new Error(
        'OIDC refresh-check tokens require migration 202611170001_oidc_refresh_and_cache_epochs.sql (oidc_* columns). Run npm run registry:migrate:node',
      )
    }
    await query(
      `INSERT INTO public.app_refresh_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1::uuid, $2::uuid, $3, now() + ($4::int * interval '1 second'))`,
      [randomUUID(), user.id, tokenHash, REFRESH_TTL_SEC],
    )
  }
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
    // Same scrypt cost as a real check — no account enumeration via timing.
    await verifyAgainstDummyHash(input.password)
    return { ok: false, status: 401, error: 'Login failed' }
  }
  const ok = await verifyPassword(input.password, user.password_hash)
  if (!ok) return { ok: false, status: 401, error: 'Login failed' }
  if (passwordNeedsRehash(user.password_hash)) {
    try {
      await query(
        `UPDATE public.app_user_credentials SET password_hash = $2, updated_at = now()
         WHERE user_id = $1::uuid AND password_hash = $3`,
        [user.id, await hashPassword(input.password), user.password_hash],
      )
    } catch (error) {
      console.warn('[auth] password rehash failed', error)
    }
  }
  return { ok: true, session: await issueSession(user) }
}

/** Concurrent tab / retry of the same refresh within this window is not treated as theft. */
export const REFRESH_REUSE_GRACE_MS = 10_000
/** Sealed IdP tokens on consumed rows are only needed for the grace window. */
export const CONSUMED_OIDC_TOKEN_RETENTION_SEC = 60

async function pruneConsumedRefreshTokens(): Promise<void> {
  try {
    // Drop IdP seals soon after grace — reuse detection still needs the row hash.
    await query(
      `UPDATE public.app_refresh_token_consumed
       SET oidc_access_token = NULL,
           oidc_refresh_token = NULL
       WHERE consumed_at < now() - ($1::int * interval '1 second')
         AND (oidc_access_token IS NOT NULL OR oidc_refresh_token IS NOT NULL)`,
      [CONSUMED_OIDC_TOKEN_RETENTION_SEC],
    )
    await query(
      `DELETE FROM public.app_refresh_token_consumed
       WHERE consumed_at < now() - ($1::int * interval '1 second')`,
      [REFRESH_TTL_SEC],
    )
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code !== '42P01' && code !== '42703') throw error
  }
}

async function findConsumedRefresh(tokenHash: string): Promise<{
  user_id: string
  consumed_at: string
  oidcAccessToken: string | null
  oidcRefreshToken: string | null
} | null> {
  try {
    const rows = await query<{
      user_id: string
      consumed_at: string
      oidc_access_token: string | null
      oidc_refresh_token: string | null
    }>(
      `SELECT user_id::text AS user_id,
              consumed_at::text AS consumed_at,
              oidc_access_token,
              oidc_refresh_token
       FROM public.app_refresh_token_consumed
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash],
    )
    const row = rows[0]
    if (!row) return null
    return {
      user_id: row.user_id,
      consumed_at: row.consumed_at,
      oidcAccessToken: openOidcToken(row.oidc_access_token),
      oidcRefreshToken: openOidcToken(row.oidc_refresh_token),
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === '42P01') return null
    // Pre-migration: consumed table without oidc_* columns.
    if (code === '42703') {
      const rows = await query<{ user_id: string; consumed_at: string }>(
        `SELECT user_id::text AS user_id, consumed_at::text AS consumed_at
         FROM public.app_refresh_token_consumed
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash],
      )
      const row = rows[0]
      if (!row) return null
      return {
        user_id: row.user_id,
        consumed_at: row.consumed_at,
        oidcAccessToken: null,
        oidcRefreshToken: null,
      }
    }
    throw error
  }
}

type ConsumedRefreshRow = {
  userId: string
  oidcAccessToken: string | null
  oidcRefreshToken: string | null
}

async function peekRefreshToken(
  tokenHash: string,
): Promise<ConsumedRefreshRow | null> {
  try {
    const rows = await query<{
      user_id: string
      oidc_access_token: string | null
      oidc_refresh_token: string | null
    }>(
      `SELECT user_id::text AS user_id,
              oidc_access_token,
              oidc_refresh_token
       FROM public.app_refresh_tokens
       WHERE token_hash = $1 AND expires_at > now()
       LIMIT 1`,
      [tokenHash],
    )
    const row = rows[0]
    if (!row) return null
    return {
      userId: row.user_id,
      oidcAccessToken: openOidcToken(row.oidc_access_token),
      oidcRefreshToken: openOidcToken(row.oidc_refresh_token),
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === '42703') {
      if (oidcCheckOnRefreshEnabled()) {
        throw new Error(
          'OIDC refresh-check requires migration 202611170001_oidc_refresh_and_cache_epochs.sql (app_refresh_tokens.oidc_*). Run npm run registry:migrate:node',
        )
      }
      const rows = await query<{ user_id: string }>(
        `SELECT user_id::text AS user_id
         FROM public.app_refresh_tokens
         WHERE token_hash = $1 AND expires_at > now()
         LIMIT 1`,
        [tokenHash],
      )
      const userId = rows[0]?.user_id
      return userId
        ? { userId, oidcAccessToken: null, oidcRefreshToken: null }
        : null
    }
    throw error
  }
}

/**
 * @param sealedOidc optional already-sealed IdP tokens to store on the consumed
 *   row (use rotated tokens from a successful IdP check).
 */
async function consumeRefreshTokenAtomic(
  tokenHash: string,
  sealedOidc?: { access: string | null; refresh: string | null },
): Promise<ConsumedRefreshRow | null> {
  const sealedAccess = sealedOidc?.access ?? null
  const sealedRefresh = sealedOidc?.refresh ?? null
  try {
    // Single statement: DELETE + INSERT so a crash cannot drop reuse detection.
    // COALESCE overrides copy rotated IdP tokens onto the consumed row.
    const rows = await query<{
      user_id: string
      oidc_access_token: string | null
      oidc_refresh_token: string | null
    }>(
      `WITH deleted AS (
         DELETE FROM public.app_refresh_tokens
         WHERE token_hash = $1 AND expires_at > now()
         RETURNING user_id, oidc_access_token, oidc_refresh_token
       ),
       inserted AS (
         INSERT INTO public.app_refresh_token_consumed (
           token_hash, user_id, oidc_access_token, oidc_refresh_token
         )
         SELECT $1,
                user_id,
                COALESCE($2, oidc_access_token),
                COALESCE($3, oidc_refresh_token)
         FROM deleted
         RETURNING user_id
       )
       SELECT d.user_id::text AS user_id,
              COALESCE($2, d.oidc_access_token) AS oidc_access_token,
              COALESCE($3, d.oidc_refresh_token) AS oidc_refresh_token
       FROM deleted d`,
      [tokenHash, sealedAccess, sealedRefresh],
    )
    void pruneConsumedRefreshTokens().catch((error) => {
      console.error('[auth] pruneConsumedRefreshTokens failed', error)
    })
    const row = rows[0]
    if (!row) return null
    return {
      userId: row.user_id,
      oidcAccessToken: openOidcToken(row.oidc_access_token),
      oidcRefreshToken: openOidcToken(row.oidc_refresh_token),
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    // Pre-migration: no consumed table and/or no oidc_* columns.
    if (code !== '42P01' && code !== '42703') throw error
    if (oidcCheckOnRefreshEnabled() && sealedOidc) {
      throw new Error(
        'OIDC refresh-check grace tokens require migration 202611170003_refresh_consumed_oidc_tokens.sql (app_refresh_token_consumed.oidc_*). Run npm run registry:migrate:node',
      )
    }
    try {
      const rows = await query<{
        user_id: string
        oidc_access_token?: string | null
        oidc_refresh_token?: string | null
      }>(
        `DELETE FROM public.app_refresh_tokens
         WHERE token_hash = $1 AND expires_at > now()
         RETURNING user_id::text AS user_id,
                   NULL::text AS oidc_access_token,
                   NULL::text AS oidc_refresh_token`,
        [tokenHash],
      )
      const row = rows[0]
      if (!row) return null
      return {
        userId: row.user_id,
        oidcAccessToken: openOidcToken(row.oidc_access_token ?? null),
        oidcRefreshToken: openOidcToken(row.oidc_refresh_token ?? null),
      }
    } catch (fallbackError) {
      if ((fallbackError as { code?: string } | null)?.code === '42703') {
        const rows = await query<{ user_id: string }>(
          `DELETE FROM public.app_refresh_tokens
           WHERE token_hash = $1 AND expires_at > now()
           RETURNING user_id::text AS user_id`,
          [tokenHash],
        )
        const userId = rows[0]?.user_id
        return userId
          ? { userId, oidcAccessToken: null, oidcRefreshToken: null }
          : null
      }
      throw fallbackError
    }
  }
}

async function deactivateUser(userId: string): Promise<void> {
  await query(
    `UPDATE public.app_users SET is_active = false, updated_at = now()
     WHERE id = $1::uuid`,
    [userId],
  )
}

/**
 * Grace / concurrent-loser path for an already-consumed CE refresh token.
 * @returns null when the hash is not in the consumed table yet.
 */
async function refreshFromConsumedGrace(
  tokenHash: string,
): Promise<
  | { ok: true; session: AuthSessionPayload }
  | { ok: false; status: number; error: string }
  | null
> {
  const consumed = await findConsumedRefresh(tokenHash)
  if (!consumed) return null
  const consumedAtMs = Date.parse(consumed.consumed_at)
  const ageMs = Number.isFinite(consumedAtMs)
    ? Date.now() - consumedAtMs
    : Number.POSITIVE_INFINITY
  if (ageMs > REFRESH_REUSE_GRACE_MS) {
    // Reuse outside the grace window → revoke every session for that user.
    await revokeAllRefreshTokensForUser(consumed.user_id)
    return { ok: false, status: 401, error: 'Refresh failed' }
  }
  // Benign client retry / second tab after a *successful* first refresh.
  // Do not call the IdP again — that would replay a possibly already-rotated
  // IdP refresh token. Tokens on the consumed row were sealed after the first
  // successful IdP check (or are null for local-login sessions).
  const user = await loadUserById(consumed.user_id)
  if (!user || !user.is_active) {
    return { ok: false, status: 401, error: 'Refresh failed' }
  }
  return {
    ok: true,
    session: await issueSession(user, {
      oidc: {
        accessToken: consumed.oidcAccessToken,
        refreshToken: consumed.oidcRefreshToken,
      },
    }),
  }
}

type BffRefreshResult =
  | { ok: true; session: AuthSessionPayload }
  | { ok: false; status: number; error: string }

/**
 * In-process single-flight for the same CE refresh token. Prevents two tabs from
 * both presenting the same IdP refresh token (Keycloak revoke-on-reuse).
 * Multi-instance still relies on grace re-check after a failed IdP call.
 */
const refreshInflight = new Map<string, Promise<BffRefreshResult>>()

export async function bffRefresh(input: {
  refreshToken: string
}): Promise<BffRefreshResult> {
  const tokenHash = hashRefreshToken(input.refreshToken)
  const existing = refreshInflight.get(tokenHash)
  if (existing) return existing

  const pending = bffRefreshExclusive(tokenHash).finally(() => {
    if (refreshInflight.get(tokenHash) === pending) {
      refreshInflight.delete(tokenHash)
    }
  })
  refreshInflight.set(tokenHash, pending)
  return pending
}

async function bffRefreshExclusive(tokenHash: string): Promise<BffRefreshResult> {
  const { assertOidcSessionStillValid, oidcDeactivateOnRejectEnabled } =
    await import('./oidcSessionCheck.js')

  const alreadyConsumed = await refreshFromConsumedGrace(tokenHash)
  if (alreadyConsumed) return alreadyConsumed

  // Peek first so IdP outage does not consume the CE refresh token.
  const peeked = await peekRefreshToken(tokenHash)
  if (!peeked) return { ok: false, status: 401, error: 'Refresh failed' }
  const user = await loadUserById(peeked.userId)
  if (!user || !user.is_active) {
    return { ok: false, status: 401, error: 'Refresh failed' }
  }

  let oidcCheck: Awaited<ReturnType<typeof assertOidcSessionStillValid>>
  try {
    oidcCheck = await assertOidcSessionStillValid({
      oidcAccessToken: peeked.oidcAccessToken,
      oidcRefreshToken: peeked.oidcRefreshToken,
    })
  } catch (error) {
    // Leave the CE refresh row intact so the client can retry.
    console.error('[auth] IdP session check failed during refresh', error)
    return {
      ok: false,
      status: 503,
      error: 'SSO temporarily unavailable',
    }
  }
  if (!oidcCheck.ok) {
    // Another instance may have already rotated + consumed — prefer grace over
    // global revoke (IdP reject is often refresh-token reuse, not a real logout).
    const racedAfterReject = await refreshFromConsumedGrace(tokenHash)
    if (racedAfterReject) return racedAfterReject
    await revokeAllRefreshTokensForUser(user.id)
    if (oidcDeactivateOnRejectEnabled()) {
      await deactivateUser(user.id)
    }
    return { ok: false, status: 401, error: 'Refresh failed' }
  }

  const nextAccess = oidcCheck.accessToken ?? peeked.oidcAccessToken
  const nextRefresh = oidcCheck.refreshToken ?? peeked.oidcRefreshToken
  // Seal rotated IdP tokens onto the consumed row for grace re-issue (no IdP replay).
  const sealedForConsumed =
    oidcCheckOnRefreshEnabled()
      ? {
          access: sealOidcToken(nextAccess),
          refresh: sealOidcToken(nextRefresh),
        }
      : undefined

  const consumedLive = await consumeRefreshTokenAtomic(tokenHash, sealedForConsumed)
  if (!consumedLive) {
    // Concurrent tab won the atomic delete — land in the grace path if still in window.
    const raced = await refreshFromConsumedGrace(tokenHash)
    if (raced) return raced
    return { ok: false, status: 401, error: 'Refresh failed' }
  }

  return {
    ok: true,
    session: await issueSession(user, {
      oidc: {
        accessToken: nextAccess,
        refreshToken: nextRefresh,
      },
    }),
  }
}

export async function bffLogout(input: {
  refreshToken: string
  accessToken?: string | null
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const tokenHash = hashRefreshToken(input.refreshToken)
  await query(`DELETE FROM public.app_refresh_tokens WHERE token_hash = $1`, [tokenHash])
  if (input.accessToken) await revokeAccessToken(input.accessToken)
  return { ok: true }
}

/**
 * Store a password for a user. Rejects insecure / over-long values unless
 * `allowInsecure` is set (local bootstrap / provision only — still forces change).
 */
export async function hashPasswordForUser(
  userId: string,
  password: string,
  options?: { mustChangePassword?: boolean; allowInsecure?: boolean },
): Promise<void> {
  const next = String(password || '')
  if (!options?.allowInsecure) {
    const policyError = passwordPolicyError(next)
    if (policyError) throw new Error(policyError)
  } else if (next.length < 8 || Buffer.byteLength(next, 'utf8') > 256) {
    throw new Error('Password must be 8–256 bytes')
  }
  const passwordHash = await hashPassword(next)
  const mustChange =
    options?.mustChangePassword === true ||
    options?.allowInsecure === true ||
    isInsecurePassword(next)
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
  await invalidateAccessTokensForUser(userId)
}

export async function bffChangePassword(input: {
  userId: string
  currentPassword: string
  newPassword: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const newPassword = input.newPassword.trim()
  const policyError = passwordPolicyError(newPassword)
  if (policyError) {
    return { ok: false, status: 400, error: policyError }
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
  await invalidateAccessTokensForUser(user.id)
  return { ok: true }
}
