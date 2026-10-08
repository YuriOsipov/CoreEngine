/**
 * Verify Supabase / GraphQL BFF cutover for local runtime.
 *
 * Usage (repo root):
 *   npm run registry:check-cutover
 *   npm run registry:check-cutover -- --require-bff
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'

const requireBff = process.argv.includes('--require-bff')

type Check = { name: string; ok: boolean; detail: string }

const checks: Check[] = []

function env(name: string): string {
  return (process.env[name] || '').trim()
}

function add(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail })
}

const dataSource = env('VITE_DATA_SOURCE').toLowerCase()
const recordsSource = env('VITE_RECORDS_SOURCE').toLowerCase()
const authMode = env('VITE_AUTH_MODE').toLowerCase()
const authBackend = env('AUTH_BACKEND').toLowerCase()
const directusRuntime = env('DIRECTUS_RUNTIME').toUpperCase()
const staticToken = env('VITE_DIRECTUS_TOKEN')

add(
  'VITE_DATA_SOURCE=graphql',
  dataSource === 'graphql',
  `got "${dataSource || '(empty)'}"`,
)
add(
  'VITE_RECORDS_SOURCE=graphql',
  recordsSource === 'graphql',
  `got "${recordsSource || '(empty)'}"`,
)
add(
  'VITE_AUTH_MODE=bff',
  authMode === 'bff' || (authMode === '' && !staticToken),
  `got "${authMode || '(empty)'}"`,
)
add(
  'AUTH_BACKEND=local',
  authBackend === 'local' || authBackend === '',
  `got "${authBackend || '(empty/default)'}"`,
)
add(
  'DIRECTUS_RUNTIME=off',
  ['OFF', '0', 'FALSE', 'NO'].includes(directusRuntime),
  `got "${directusRuntime || '(empty=on)'}"`,
)
add(
  'VITE_DIRECTUS_TOKEN unset',
  !staticToken,
  staticToken ? 'static token still set' : 'ok',
)

const backends = await query<{ backend_target: string; count: string }>(
  `SELECT backend_target, count(*)::text AS count
   FROM public.entities
   WHERE deleted_at IS NULL
   GROUP BY backend_target
   ORDER BY backend_target`,
)
const byTarget = Object.fromEntries(
  backends.map((row) => [row.backend_target.toUpperCase(), Number(row.count)]),
)
const directusCount = byTarget.DIRECTUS ?? 0
const platformCount = byTarget.PLATFORM ?? 0
const supabaseCount = byTarget.SUPABASE ?? 0
const hasuraCount = byTarget.HASURA ?? 0
const knownBackends = new Set(['SUPABASE', 'PLATFORM', 'HASURA', 'DIRECTUS'])
const unknownBackends = Object.entries(byTarget).filter(([key]) => !knownBackends.has(key))

add(
  'entity backend_target values',
  unknownBackends.length === 0,
  `DIRECTUS=${directusCount} PLATFORM=${platformCount} SUPABASE=${supabaseCount} HASURA=${hasuraCount}${
    unknownBackends.length
      ? ` unknown=${unknownBackends.map(([key, count]) => `${key}=${count}`).join(',')}`
      : ''
  }`,
)
add(
  'PLATFORM entities present',
  platformCount >= 3,
  `PLATFORM=${platformCount}`,
)

const typedRows = await query<{ typed: string; total: string }>(
  `SELECT count(*) FILTER (
      WHERE COALESCE(backend_config->>'storage', 'typed') = 'typed'
    )::text AS typed,
          count(*)::text AS total
   FROM public.entities
   WHERE deleted_at IS NULL AND backend_target = 'SUPABASE'`,
)
const typedCount = Number(typedRows[0]?.typed ?? 0)
const supabaseTotal = Number(typedRows[0]?.total ?? 0)
add(
  'SUPABASE entities use crm_schema (typed)',
  supabaseTotal === 0 || typedCount === supabaseTotal,
  supabaseTotal === 0 ? 'none (HASURA/DIRECTUS/PLATFORM only)' : `typed=${typedCount}/${supabaseTotal}`,
)

const brLeft = await query<{ count: string }>(
  `SELECT count(*)::text AS count FROM public.business_records`,
)
add(
  'business_records drained',
  Number(brLeft[0]?.count ?? 0) === 0,
  `rows=${brLeft[0]?.count ?? 0}`,
)

const creds = await query<{ count: string }>(
  `SELECT count(*)::text AS count
   FROM public.app_user_credentials c
   JOIN public.app_users u ON u.id = c.user_id`,
)
add(
  'local credentials exist',
  Number(creds[0]?.count ?? 0) > 0,
  `app_user_credentials=${creds[0]?.count ?? 0}`,
)

const orphanFiles = await query<{
  junction_id: string
  file_id: string
  parent_id: string | null
  entity_api_name: string
}>(
  `SELECT 'visit_files'::text AS entity_api_name,
          vf.record_id AS junction_id,
          vf.data->>'file_id' AS file_id,
          vf.data->>'visit_id' AS parent_id
   FROM crm_schema.visit_files vf
   LEFT JOIN public.files f
     ON f.deleted_at IS NULL
    AND (f.id::text = vf.data->>'file_id' OR f.backend_file_id = vf.data->>'file_id')
   WHERE vf.status <> 'archived'
     AND COALESCE(vf.data->>'file_id', '') <> ''
     AND f.id IS NULL
   ORDER BY vf.record_id
   LIMIT 20`,
)
const orphanCountRows = await query<{ count: string }>(
  `SELECT count(*)::text AS count
   FROM crm_schema.visit_files vf
   LEFT JOIN public.files f
     ON f.deleted_at IS NULL
    AND (f.id::text = vf.data->>'file_id' OR f.backend_file_id = vf.data->>'file_id')
   WHERE vf.status <> 'archived'
     AND COALESCE(vf.data->>'file_id', '') <> ''
     AND f.id IS NULL`,
)
const orphanCount = Number(orphanCountRows[0]?.count ?? 0)
const orphanSample = orphanFiles
  .slice(0, 5)
  .map((row) => `${row.entity_api_name}/${row.junction_id}->${row.file_id}`)
  .join(', ')
add(
  'file junction refs resolve in public.files',
  orphanCount === 0,
  orphanCount === 0
    ? 'ok'
    : `orphans=${orphanCount}${orphanSample ? ` sample=${orphanSample}` : ''} (npm run registry:cleanup-orphan-file-refs -- --apply)`,
)

const graphqlUrl = env('VITE_GRAPHQL_URL') || 'http://localhost:4000/graphql'
const bffBase = graphqlUrl.replace(/\/graphql\/?$/i, '') || 'http://localhost:4000'

try {
  const response = await fetch(`${bffBase}/health`, {
    headers: { Accept: 'application/json' },
  })
  const body = (await response.json().catch(() => null)) as { ok?: boolean } | null
  add(
    'BFF /health',
    response.ok && body?.ok !== false,
    `HTTP ${response.status} ${JSON.stringify(body)}`,
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  add('BFF /health', !requireBff, requireBff ? `unreachable: ${message}` : `skipped (BFF down): ${message}`)
}

const failed = checks.filter((check) => !check.ok)
for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name} — ${check.detail}`)
}

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      passed: checks.length - failed.length,
      failed: failed.length,
      bffBase,
    },
    null,
    2,
  ),
)

await pool.end()
process.exitCode = failed.length ? 1 : 0
