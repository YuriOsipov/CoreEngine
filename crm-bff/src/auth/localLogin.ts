/**
 * Local email/password login toggle.
 * Default: enabled. Set AUTH_LOCAL_LOGIN_ENABLED=false to require SSO only
 * (IdP MFA cannot be bypassed via /auth/login).
 */
export function isLocalLoginEnabled(): boolean {
  const raw = String(process.env.AUTH_LOCAL_LOGIN_ENABLED ?? 'true')
    .trim()
    .toLowerCase()
  if (!raw) return true
  return !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off')
}
