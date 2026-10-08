/**
 * Assert files.uploaded_by expands to a nested user object,
 * and files.created_at maps to API created_on.
 *
 * Usage: npm run bff:check-files-uploaded-by
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { findFile } from '../crm-bff/src/adapters/filesAdapter.ts'
import { clearRecordsBackendCache } from '../crm-bff/src/adapters/recordsAdapter.ts'
import { clearRecordRelationsCache } from '../crm-bff/src/adapters/recordRelations.ts'

clearRecordsBackendCache()
clearRecordRelationsCache()

let failed = 0
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log('ok:', message)
    return
  }
  failed += 1
  console.error('FAIL:', message)
}

const users = await query<{ backend_user_id: string; email: string }>(
  `SELECT backend_user_id, email
   FROM public.app_users
   WHERE backend_user_id IS NOT NULL
   ORDER BY email
   LIMIT 1`,
)
const user = users[0]
if (!user) {
  console.error('FAIL: no app_users with backend_user_id')
  await pool.end()
  process.exit(1)
}

const files = await query<{ id: string; created_at: string }>(
  `SELECT id::text AS id, created_at::text AS created_at
   FROM public.files
   WHERE deleted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1`,
)
const file = files[0]
if (!file) {
  console.error('FAIL: no public.files rows to test')
  await pool.end()
  process.exit(1)
}

await query(
  `UPDATE public.files
   SET uploaded_by = $2::uuid, updated_at = now()
   WHERE id::text = $1`,
  [file.id, user.backend_user_id],
)

const shaped = await findFile(file.id, [
  'id',
  'created_on',
  'uploaded_by.id',
  'uploaded_by.first_name',
  'uploaded_by.last_name',
  'uploaded_by.email',
])

assert(
  typeof shaped.created_on === 'string' && shaped.created_on.length > 0,
  'created_on is a non-empty string',
)
assert(
  String(shaped.created_on) === file.created_at,
  `created_on matches DB created_at (${file.created_at})`,
)

const uploadedBy = shaped.uploaded_by
assert(
  uploadedBy != null && typeof uploadedBy === 'object',
  'uploaded_by expanded to object',
)
assert(
  typeof uploadedBy === 'object' &&
    String((uploadedBy as { id?: unknown }).id) === user.backend_user_id,
  `uploaded_by.id matches ${user.backend_user_id}`,
)
assert(
  typeof uploadedBy === 'object' &&
    String((uploadedBy as { email?: unknown }).email || '') === user.email,
  `uploaded_by.email matches ${user.email}`,
)

await pool.end()

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}

console.log('\nok: files.uploaded_by + created_on path')
