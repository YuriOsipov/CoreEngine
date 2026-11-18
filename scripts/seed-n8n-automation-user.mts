/**
 * Ensure a dedicated n8n automation app_users row + password.
 *
 * Default role: non-admin **Integration** with full object CRUD grants
 * (not admin / FLS bypass). Use --admin only when you intentionally need
 * Setup/registry access from n8n.
 *
 * Usage (repo root):
 *   npm run registry:seed-n8n-automation-user
 *   npm run registry:seed-n8n-automation-user -- --email=n8n@system.local --generate
 *   npm run registry:seed-n8n-automation-user -- --admin
 *   npm run registry:seed-n8n-automation-user -- --role=Integration
 *   npm run registry:seed-n8n-automation-user -- --dry-run
 *
 * n8n should: POST /auth/login → Bearer access_token on GraphQL mutations,
 * and send header X-CRM-Automation: n8n on every BFF call.
 */
import { randomBytes } from 'node:crypto'
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { hashPassword } from '../crm-bff/src/auth/passwords.ts'
import { resolveN8nAutomationRole } from '../crm-bff/src/auth/n8nAutomationRole.ts'

const dryRun = process.argv.includes('--dry-run')
const generate = process.argv.includes('--generate')
const wantAdmin = process.argv.includes('--admin')

function argValue(prefix: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1).trim() || null : null
}

const email = (argValue('--email') || 'n8n@system.local').toLowerCase()
const passwordArg = argValue('--password')
const roleNameArg = argValue('--role')

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

let role
try {
  role = await resolveN8nAutomationRole({
    wantAdmin,
    roleName: roleNameArg,
    dryRun,
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
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
      [email, role.id],
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
    [userId, role.id],
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
      roleId: role.id,
      roleName: role.name,
      roleIsAdmin: role.isAdmin,
      ...(dryRun ? {} : { password }),
      note: dryRun
        ? 'No changes'
        : role.isAdmin
          ? 'Admin automation user — FLS/owner RLS bypass. Prefer default Integration role unless Setup access is required.'
          : 'Non-admin Integration user with object CRUD. Send X-CRM-Automation: n8n on GraphQL calls. Owner RLS stamps owner_id (and audit user_created) to this account.',
    },
    null,
    2,
  ),
)

await pool.end()
