import { query } from '../db/pool.js'
import { BOOTSTRAP_EMAILS, KNOWN_INSECURE_PASSWORDS } from './insecurePasswords.js'
import { verifyPassword } from './passwords.js'

/**
 * Production-only: refuse start when a bootstrap account still uses a known
 * example/default password (e.g. admin12345 / ChangeMeNow!).
 */
export async function assertProductionBootstrapPasswordsSafe(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return

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
          `Refusing to start in production: ${email} still uses a known insecure password. ` +
            `Run registry:set-user-password / platform provision with a unique secret, then sign in and change it.`,
        )
      }
    }
  }
}
