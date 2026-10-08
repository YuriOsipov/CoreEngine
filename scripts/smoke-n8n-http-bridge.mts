/**
 * End-to-end bridge smoke without a real n8n process:
 * 1) Ephemeral webhook receives BFF http flow (+ secret / source headers)
 * 2) Login as n8n automation user → GraphQL updateRecord with X-CRM-Automation
 * 3) POST /flows/trigger rejects automation re-entry (409)
 *
 * Requires BFF at BFF_URL (default http://localhost:4000).
 *
 * Usage: npm run registry:smoke-n8n-http-bridge
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { hashPassword } from '../crm-bff/src/auth/passwords.ts'
import { runLocalFlow } from '../crm-bff/src/flows/localFlows.ts'
import { signAccessToken } from '../crm-bff/src/auth/jwt.ts'
import {
  CRM_AUTOMATION_HEADER,
  CRM_FLOW_SECRET_HEADER,
  CRM_SOURCE_HEADER,
} from '../crm-bff/src/flows/flowAuth.ts'

const BFF_URL = (process.env.BFF_URL || 'http://localhost:4000').replace(/\/$/, '')
const FLOW_KEY = '_smoke_n8n_http'
const EMAIL = 'n8n@system.local'
const PASSWORD = `n8n-smoke-${randomBytes(6).toString('hex')}`
const SECRET = `whsec_${randomBytes(12).toString('hex')}`
const NOTE = `__n8n_bridge_${Date.now()}__`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

type Captured = {
  headers: http.IncomingHttpHeaders
  body: Record<string, unknown>
}

const captured: Captured[] = []

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  let body: Record<string, unknown> = {}
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    body = { raw }
  }
  captured.push({ headers: req.headers, body })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, received: true }))
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const addr = server.address()
assert(addr && typeof addr === 'object', 'server address missing')
const webhookUrl = `http://127.0.0.1:${addr.port}/webhook/crm-flow`

process.env.N8N_WEBHOOK_SECRET = SECRET

const users = await query<{ id: string }>(
  `SELECT id::text AS id FROM public.app_users WHERE lower(email) = lower($1) LIMIT 1`,
  [EMAIL],
)
assert(users[0]?.id, `missing automation user ${EMAIL} — run registry:seed-n8n-automation-user`)
const passwordHash = await hashPassword(PASSWORD)
await query(
  `INSERT INTO public.app_user_credentials (user_id, password_hash)
   VALUES ($1::uuid, $2)
   ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
  [users[0].id, passwordHash],
)

const visits = await query<{ record_id: string; note: string | null }>(
  `SELECT record_id, data->>'note' AS note
   FROM crm_schema.visit
   WHERE status = 'published'
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1`,
)
assert(visits[0]?.record_id, 'no published visit for GraphQL write-back smoke')
const visitId = visits[0].record_id
const previousNote = visits[0].note

await query(
  `INSERT INTO public.app_flow_triggers (key, handler, enabled, description, config)
   VALUES ($1, 'http', true, 'Ephemeral n8n bridge smoke', $2::jsonb)
   ON CONFLICT (key) DO UPDATE SET
     handler = 'http', enabled = true, config = EXCLUDED.config, updated_at = now()`,
  [FLOW_KEY, JSON.stringify({ url: webhookUrl, method: 'POST' })],
)

try {
  const health = await fetch(`${BFF_URL}/health`)
  assert(health.ok, `BFF not healthy at ${BFF_URL}`)

  const flowResult = await runLocalFlow(FLOW_KEY, {
    collection: 'visit',
    recordId: visitId,
    action: { id: 'smoke', name: 'n8n_bridge', label: 'n8n bridge' },
  })
  assert(flowResult.ok && flowResult.handler === 'http', 'http flow failed')
  assert(captured.length === 1, `expected 1 webhook hit, got ${captured.length}`)
  const hit = captured[0]
  assert(
    String(hit.headers[CRM_FLOW_SECRET_HEADER] || '') === SECRET,
    'missing/wrong X-CRM-Flow-Secret',
  )
  assert(
    String(hit.headers[CRM_SOURCE_HEADER] || '') === 'bff-flow',
    'missing X-CRM-Source: bff-flow',
  )
  assert(hit.body.collection === 'visit', 'webhook body.collection')
  assert(hit.body.recordId === visitId, 'webhook body.recordId')
  console.log('ok: BFF http → mock n8n webhook (+ secret)')

  const loginRes = await fetch(`${BFF_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const loginBody = (await loginRes.json()) as {
    access_token?: string
    error?: string
  }
  assert(loginRes.ok && loginBody.access_token, `login failed: ${loginBody.error || loginRes.status}`)

  const gqlRes = await fetch(`${BFF_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${loginBody.access_token}`,
      'X-CRM-Automation': 'n8n',
    },
    body: JSON.stringify({
      query:
        'mutation($e:String!,$id:ID!,$d:JSON!){ updateRecord(entity:$e,id:$id,data:$d) }',
      variables: {
        e: 'visit',
        id: visitId,
        d: { note: NOTE },
      },
    }),
  })
  const gqlJson = (await gqlRes.json()) as {
    data?: { updateRecord?: { id?: string; note?: string } }
    errors?: { message: string }[]
  }
  assert(
    gqlRes.ok && !gqlJson.errors?.length,
    `updateRecord failed: ${JSON.stringify(gqlJson.errors || gqlJson)}`,
  )
  const after = await query<{ note: string | null }>(
    `SELECT data->>'note' AS note FROM crm_schema.visit WHERE record_id = $1`,
    [visitId],
  )
  assert(after[0]?.note === NOTE, `note not updated via GraphQL (got ${after[0]?.note})`)
  console.log('ok: n8n user → GraphQL updateRecord (+ X-CRM-Automation)')

  const jwt = signAccessToken({ id: users[0].id, adminAccess: true })
  const triggerOk = await fetch(`${BFF_URL}/flows/trigger/ack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ ping: true }),
  })
  assert(triggerOk.ok, `authenticated trigger failed: ${triggerOk.status}`)
  console.log('ok: /flows/trigger with JWT')

  const triggerLoop = await fetch(`${BFF_URL}/flows/trigger/ack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      [CRM_AUTOMATION_HEADER]: 'n8n',
    },
    body: JSON.stringify({ ping: true }),
  })
  assert(triggerLoop.status === 409, `expected 409 re-entry, got ${triggerLoop.status}`)
  console.log('ok: /flows/trigger rejects X-CRM-Automation re-entry')

  console.log(
    JSON.stringify(
      {
        ok: true,
        webhookUrl,
        visitId,
        bff: BFF_URL,
      },
      null,
      2,
    ),
  )
} finally {
  await query(
    `UPDATE crm_schema.visit
     SET data = CASE
           WHEN $2::text = '' THEN COALESCE(data, '{}'::jsonb) - 'note'
           ELSE jsonb_set(COALESCE(data, '{}'::jsonb), '{note}', to_jsonb($2::text), true)
         END,
         updated_at = now()
     WHERE record_id = $1`,
    [visitId, previousNote ?? ''],
  ).catch(() => undefined)

  await query(`DELETE FROM public.app_flow_triggers WHERE key = $1`, [FLOW_KEY])
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  )
  await pool.end()
}
