/**
 * Flip one registry entity backend_target.
 *
 * Usage:
 *   node --env-file=.env --env-file=supabase/.env ./scripts/set-entity-backend.mjs <api_name> SUPABASE
 *   node --env-file=.env --env-file=supabase/.env ./scripts/set-entity-backend.mjs <api_name> HASURA
 *   node --env-file=.env --env-file=supabase/.env ./scripts/set-entity-backend.mjs <api_name> DIRECTUS
 *   node --env-file=.env --env-file=supabase/.env ./scripts/set-entity-backend.mjs <api_name> PLATFORM
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'crm-bff', 'package.json'))
const pg = require('pg')

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx < 1) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    // optional
  }
}

loadEnv(join(root, 'supabase', '.env'))
loadEnv(join(root, '.env'))

const ALLOWED = new Set(['SUPABASE', 'DIRECTUS', 'PLATFORM', 'STRAPI', 'PAYLOAD', 'HASURA'])
const apiName = process.argv[2]?.trim()
const backend = process.argv[3]?.trim()?.toUpperCase()
if (!apiName || !backend || !ALLOWED.has(backend)) {
  console.error(
    'Usage: set-entity-backend.mjs <api_name> <SUPABASE|HASURA|DIRECTUS|PLATFORM|STRAPI|PAYLOAD>',
  )
  process.exit(1)
}

const host =
  process.env.POSTGRES_HOST === 'host.docker.internal'
    ? 'localhost'
    : process.env.POSTGRES_HOST || 'localhost'
const client = new pg.Client({
  host,
  port: Number(process.env.POSTGRES_PORT || 5434),
  database: process.env.POSTGRES_DB || 'supabase',
  user: process.env.POSTGRES_BOOTSTRAP_USER || process.env.POSTGRES_USER || 'postgres',
  password:
    process.env.POSTGRES_BOOTSTRAP_PASSWORD || process.env.POSTGRES_PASSWORD || '',
})

await client.connect()
const result = await client.query(
  `UPDATE public.entities
   SET backend_target = $2, updated_at = now()
   WHERE api_name = $1 AND deleted_at IS NULL
   RETURNING api_name, backend_target`,
  [apiName, backend],
)
await client.end()

if (!result.rowCount) {
  console.error(`FAIL: entity not found: ${apiName}`)
  process.exit(1)
}

console.log(`ok: ${result.rows[0].api_name} -> ${result.rows[0].backend_target}`)
