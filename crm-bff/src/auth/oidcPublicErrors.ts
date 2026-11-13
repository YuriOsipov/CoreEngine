/**
 * Browser-facing SSO error codes (safe for ?sso_error=).
 * Detailed reasons stay on the server log — never in the redirect URL.
 */
export const OIDC_PUBLIC_ERRORS = {
  denied: 'sso_denied',
  failed: 'sso_failed',
  unavailable: 'sso_unavailable',
} as const

export type OidcPublicErrorCode =
  (typeof OIDC_PUBLIC_ERRORS)[keyof typeof OIDC_PUBLIC_ERRORS]

/** Map internal callback/status failures to a non-enumerating public code. */
export function oidcPublicErrorCode(input: {
  status: number
  error: string
}): OidcPublicErrorCode {
  if (input.status === 503) return OIDC_PUBLIC_ERRORS.unavailable
  if (input.status === 401 || /denied|access_denied/i.test(input.error)) {
    return OIDC_PUBLIC_ERRORS.denied
  }
  return OIDC_PUBLIC_ERRORS.failed
}
