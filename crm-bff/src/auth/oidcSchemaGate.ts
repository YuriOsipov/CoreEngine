/**
 * Boot gate: OIDC refresh-time IdP checks need sealed-token columns on
 * app_refresh_tokens and app_refresh_token_consumed.
 */
import { query } from '../db/pool.js'
import { oidcCheckOnRefreshEnabled } from './oidcSessionCheck.js'

function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === '42703' || code === '42P01'
}

/**
 * When `OIDC_CHECK_ON_REFRESH` is on (and OIDC is enabled), refuse start if
 * migrations `202611170001_*` / `202611170003_*` have not been applied.
 * Surfaces at boot instead of a 500 on SSO login/refresh.
 */
export async function assertOidcRefreshTokenSchemaReady(): Promise<void> {
  if (!oidcCheckOnRefreshEnabled()) return
  try {
    await query(
      `SELECT t.oidc_access_token, t.oidc_refresh_token,
              c.oidc_access_token, c.oidc_refresh_token
       FROM public.app_refresh_tokens t
       CROSS JOIN public.app_refresh_token_consumed c
       LIMIT 0`,
    )
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error
    throw new Error(
      'Refusing to start: OIDC_CHECK_ON_REFRESH requires oidc_* columns on ' +
        'app_refresh_tokens and app_refresh_token_consumed. Apply migrations ' +
        '202611170001_oidc_refresh_and_cache_epochs.sql and ' +
        '202611170003_refresh_consumed_oidc_tokens.sql ' +
        '(npm run registry:migrate / registry:migrate:node), or set ' +
        'OIDC_CHECK_ON_REFRESH=false.',
    )
  }
}
