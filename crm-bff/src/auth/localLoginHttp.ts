import { isLocalLoginEnabled } from './localLogin.js'

/** Shared 403 body when AUTH_LOCAL_LOGIN_ENABLED=false. */
export const LOCAL_LOGIN_DISABLED_ERROR =
  'Local password login is disabled. Sign in with SSO or ask an administrator.'

/**
 * Guard for POST /auth/login. Refresh and OIDC paths stay available so
 * SSO-only deploys can still mint/rotate sessions.
 */
export function localLoginHttpGuard():
  | { ok: true }
  | { ok: false; status: 403; error: string } {
  if (isLocalLoginEnabled()) return { ok: true }
  return { ok: false, status: 403, error: LOCAL_LOGIN_DISABLED_ERROR }
}
