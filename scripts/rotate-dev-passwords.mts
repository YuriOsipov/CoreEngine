/**
 * Rotate local BFF passwords for known bootstrap emails.
 * Generates one shared strong password and prints it once.
 *
 * Usage (repo root):
 *   npm run registry:rotate-dev-passwords
 *   npm run registry:rotate-dev-passwords -- --dry-run
 */
import { randomBytes } from 'node:crypto'
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { hashPassword } from '../crm-bff/src/auth/passwords.ts'

const dryRun = process.argv.includes('--dry-run')
const BOOTSTRAP_EMAILS = ['admin@example.com', 'user@example.com']

function generatePassword(bytes = 18): string {
  return randomBytes(bytes).toString('base64url')
}

const password = generatePassword()
const passwordHash = dryRun ? null : await hashPassword(password)

const updated: string[] = []
const missing: string[] = []

for (const email of BOOTSTRAP_EMAILS) {
  const users = await query<{ id: string; email: string | null }>(
    `SELECT id::text AS id, email
     FROM public.app_users
     WHERE lower(email) = lower($1)
     LIMIT 1`,
    [email],
  )
  const user = users[0]
  if (!user) {
    missing.push(email)
    continue
  }

  if (!dryRun && passwordHash) {
    await query(
      `INSERT INTO public.app_user_credentials (user_id, password_hash, must_change_password)
       VALUES ($1::uuid, $2, true)
       ON CONFLICT (user_id) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         must_change_password = true,
         updated_at = now()`,
      [user.id, passwordHash],
    )
  }
  updated.push(user.email ?? email)
}

console.log(
  JSON.stringify(
    {
      dryRun,
      updated,
      missing,
      ...(dryRun ? {} : { password }),
      note: dryRun
        ? 'No credentials changed'
        : 'Store this password; it will not be shown again. Old crm-local-dev no longer works.',
    },
    null,
    2,
  ),
)

await pool.end()
if (!updated.length) process.exitCode = 1
