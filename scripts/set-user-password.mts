/**
 * Set / reset a local BFF login password for an app_users email.
 *
 * Usage (repo root):
 *   npm run registry:set-user-password -- user@example.com 'secret'
 *   npm run registry:set-user-password -- user@example.com --generate
 *   npm run registry:set-user-password -- admin@example.com 'secret' --must-change
 */
import { randomBytes } from 'node:crypto'
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { isInsecurePassword } from '../crm-bff/src/auth/insecurePasswords.ts'
import { hashPassword } from '../crm-bff/src/auth/passwords.ts'

function generatePassword(bytes = 18): string {
  return randomBytes(bytes).toString('base64url')
}

const email = process.argv[2]?.trim()
const passwordArg = process.argv[3]
const generate = passwordArg === '--generate' || process.argv.includes('--generate')
const mustChangeFlag = process.argv.includes('--must-change')

if (!email || (!generate && !passwordArg)) {
  console.error("Usage: registry:set-user-password -- <email> '<password>' [--must-change]")
  console.error('   or: registry:set-user-password -- <email> --generate [--must-change]')
  process.exit(1)
}

const password = generate
  ? generatePassword()
  : passwordArg === '--must-change'
    ? ''
    : passwordArg
if (!password || password.length < 8) {
  console.error('Password must be at least 8 characters')
  process.exit(1)
}

const users = await query<{ id: string; email: string | null }>(
  `SELECT id::text AS id, email
   FROM public.app_users
   WHERE lower(email) = lower($1)
   LIMIT 1`,
  [email],
)
const user = users[0]
if (!user) {
  console.error(`No app_users row for email: ${email}`)
  process.exitCode = 1
  await pool.end()
  process.exit(1)
}

const mustChangePassword = mustChangeFlag || isInsecurePassword(password)
const passwordHash = await hashPassword(password)
await query(
  `INSERT INTO public.app_user_credentials (user_id, password_hash, must_change_password)
   VALUES ($1::uuid, $2, $3)
   ON CONFLICT (user_id) DO UPDATE SET
     password_hash = EXCLUDED.password_hash,
     must_change_password = EXCLUDED.must_change_password,
     updated_at = now()`,
  [user.id, passwordHash, mustChangePassword],
)
await query(`DELETE FROM public.app_refresh_tokens WHERE user_id = $1::uuid`, [user.id])

console.log(`ok: password set for ${user.email ?? email} (app_users.id=${user.id})`)
console.log(
  `ok: must_change_password=${mustChangePassword ? 'true' : 'false'}`,
)
console.log('ok: revoked refresh tokens for that user')
if (generate) {
  console.log(`password: ${password}`)
}
await pool.end()
