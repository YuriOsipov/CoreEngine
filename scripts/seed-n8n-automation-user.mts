/**
 * Ensure a dedicated n8n automation app_users row (admin role) + password.
 *
 * Usage (repo root):
 *   npm run registry:seed-n8n-automation-user
 *   npm run registry:seed-n8n-automation-user -- --email=n8n@system.local --generate
 *   npm run registry:seed-n8n-automation-user -- --dry-run
 *
 * n8n should: POST /auth/login → Bearer access_token on GraphQL mutations,
 * and send header X-CRM-Automation: n8n on every BFF call.
 */
import { randomBytes } from 'node:crypto'
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { hashPassword } from '../crm-bff/src/auth/passwords.ts'

const dryRun = process.argv.includes('--dry-run')
const generate = process.argv.includes('--generate')

function argValue(prefix: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1).trim() || null : null
}

const email = (argValue('--email') || 'n8n@system.local').toLowerCase()
const passwordArg = argValue('--password')

function generatePassword(bytes = 18): string {
  return randomBytes(bytes).toString('base64url')
}

const password =
  passwordArg ||
  (generate || !dryRun ? generatePassword() : 'dry-run-password-placeholder')

if (!dryRun && password.length < 8) {
  console.error('Password must be at least 8 characters')
  await pool.end()
  process.exit(1)
}

const adminRoles = await query<{ id: string; name: string | null }>(
  `SELECT id::text AS id, name
   FROM public.app_roles
   WHERE is_admin = true
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1`,
)
const adminRole = adminRoles[0]
if (!adminRole) {
  console.error('No app_roles with is_admin=true — create an admin role first')
  await pool.end()
  process.exit(1)
}

const existing = await query<{ id: string; email: string | null }>(
  `SELECT id::text AS id, email
   FROM public.app_users
   WHERE lower(email) = lower($1)
   LIMIT 1`,
  [email],
)

let userId = existing[0]?.id ?? null
let created = false

if (!userId) {
  if (!dryRun) {
    const inserted = await query<{ id: string }>(
      `INSERT INTO public.app_users (
         email, first_name, last_name, role_id, backend_user_id, is_active
       ) VALUES ($1, 'n8n', 'Automation', $2::uuid, NULL, true)
       RETURNING id::text AS id`,
      [email, adminRole.id],
    )
    userId = inserted[0]?.id ?? null
    if (userId) {
      await query(
        `UPDATE public.app_users SET backend_user_id = $1 WHERE id = $2::uuid`,
        [userId, userId],
      )
    }
  }
  created = true
} else if (!dryRun) {
  await query(
    `UPDATE public.app_users
     SET role_id = $2::uuid, is_active = true, updated_at = now()
     WHERE id = $1::uuid`,
    [userId, adminRole.id],
  )
}

if (!dryRun && userId) {
  const passwordHash = await hashPassword(password)
  await query(
    `INSERT INTO public.app_user_credentials (user_id, password_hash)
     VALUES ($1::uuid, $2)
     ON CONFLICT (user_id) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       updated_at = now()`,
    [userId, passwordHash],
  )
}

console.log(
  JSON.stringify(
    {
      dryRun,
      created,
      email,
      userId,
      roleId: adminRole.id,
      roleName: adminRole.name,
      ...(dryRun ? {} : { password }),
      note: dryRun
        ? 'No changes'
        : 'Store password for n8n credentials; send X-CRM-Automation: n8n on GraphQL calls',
    },
    null,
    2,
  ),
)

await pool.end()
