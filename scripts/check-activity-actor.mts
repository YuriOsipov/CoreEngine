/**
 * Assert record mutations stamp activities.user_id from GraphQL authorization.
 *
 * Usage: npm run bff:check-activity-actor
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { signAccessToken } from '../crm-bff/src/auth/jwt.ts'
import { listRecordActivities } from '../crm-bff/src/audit/auditService.ts'
import { listUsers } from '../crm-bff/src/adapters/usersAdapter.ts'
import { resolvers } from '../crm-bff/src/resolvers/index.ts'

let failed = 0
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log('ok:', message)
    return
  }
  failed += 1
  console.error('FAIL:', message)
}

const users = await query<{
  backend_user_id: string
  email: string
  first_name: string | null
  last_name: string | null
}>(
  `SELECT backend_user_id, email, first_name, last_name
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

const records = await query<{ entity_api_name: string; record_id: string }>(
  `SELECT 'visit'::text AS entity_api_name, record_id
   FROM crm_schema.visit
   WHERE status <> 'archived'
   ORDER BY updated_at DESC
   LIMIT 1`,
)
const record = records[0]
if (!record) {
  console.error('FAIL: no visit rows in crm_schema.visit to update')
  await pool.end()
  process.exit(1)
}

const token = signAccessToken({ id: user.backend_user_id, adminAccess: true })
const ctx = { authorization: `Bearer ${token}` }

const beforeCount = (
  await listRecordActivities({
    entityApiName: record.entity_api_name,
    recordId: record.record_id,
    actions: ['UPDATE'],
    limit: 5,
  })
).length

await resolvers.Mutation.updateRecord(
  null,
  {
    entity: record.entity_api_name,
    id: record.record_id,
    data: {},
    fields: ['id'],
  },
  ctx,
)

const activities = await listRecordActivities({
  entityApiName: record.entity_api_name,
  recordId: record.record_id,
  actions: ['UPDATE'],
  limit: 5,
})

assert(activities.length > beforeCount, 'UPDATE activity row written')
const latest = activities[0]
assert(
  latest?.userId === user.backend_user_id,
  `activity.userId matches actor (${user.backend_user_id})`,
)

const labeled = await listUsers({
  ids: [user.backend_user_id],
  fields: ['id', 'first_name', 'last_name', 'email'],
  limit: 1,
})
const labeledUser = labeled[0]
assert(Boolean(labeledUser), 'listUsers resolves actor for activity UI')
assert(
  String(labeledUser?.email || '') === user.email,
  `listUsers email matches ${user.email}`,
)

await pool.end()

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}

console.log('\nok: activity actor stamp path')
