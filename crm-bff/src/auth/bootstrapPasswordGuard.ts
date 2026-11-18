import { query } from '../db/pool.js'
import { BOOTSTRAP_EMAILS, KNOWN_INSECURE_PASSWORDS } from './insecurePasswords.js'
import { verifyPassword } from './passwords.js'

/**
 * True when operators explicitly allow known-weak bootstrap passwords
 * (local/dev escape hatch). Default is refuse.
 */
export function allowInsecureBootstrapPasswords(): boolean {
  const raw = String(process.env.ALLOW_INSECURE_BOOTSTRAP || '')
    .trim()
    .toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

/**
 * Refuse start when a bootstrap account still uses a known example/default
 * password (e.g. admin12345 / ChangeMeNow!). Runs in every NODE_ENV unless
 * ALLOW_INSECURE_BOOTSTRAP=true.
 */
export async function assertBootstrapPasswordsSafe(): Promise<void> {
  if (allowInsecureBootstrapPasswords()) return

  const emails = [...BOOTSTRAP_EMAILS]
  const rows = await query<{ email: string | null; password_hash: string }>(
    `SELECT u.email, c.password_hash
     FROM public.app_users u
     INNER JOIN public.app_user_credentials c ON c.user_id = u.id
     WHERE u.is_active = true
       AND lower(u.email) = ANY($1::text[])`,
    [emails.map((e) => e.toLowerCase())],
  )

  for (const row of rows) {
    const email = (row.email || '').trim() || '(unknown)'
    for (const candidate of KNOWN_INSECURE_PASSWORDS) {
      if (await verifyPassword(candidate, row.password_hash)) {
        throw new Error(
          `Refusing to start: ${email} still uses a known insecure password. ` +
            `Run registry:set-user-password / platform provision with a unique secret, then sign in and change it. ` +
            `For local-only exceptions set ALLOW_INSECURE_BOOTSTRAP=true.`,
        )
      }
    }
  }
}

/** @deprecated Use assertBootstrapPasswordsSafe — kept for import compatibility. */
export const assertProductionBootstrapPasswordsSafe = assertBootstrapPasswordsSafe
