/**
 * Smoke-test PostgREST registry snapshot shape (entities + fields + relations).
 * Usage: npm run registry:check-rest-snapshot
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(path) {
  const map = {}
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx < 1) continue
      map[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    }
  } catch {
    // optional
  }
  return map
}

const env = {
  ...loadEnvFile(join(root, 'supabase', '.env')),
  ...loadEnvFile(join(root, '.env')),
}

const baseUrl = (env.VITE_SUPABASE_URL || env.SUPABASE_PUBLIC_URL || 'http://localhost:8000')
  .replace(/\/$/, '')
const anonKey = env.VITE_SUPABASE_ANON_KEY || env.ANON_KEY
if (!anonKey) {
  console.error('FAIL: missing VITE_SUPABASE_ANON_KEY / ANON_KEY')
  process.exit(1)
}

async function restGet(path, query = {}) {
  const url = new URL(`${baseUrl}/rest/v1/${path}`)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: 'application/json',
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`PostgREST ${response.status} ${path}: ${text}`)
  }
  return text ? JSON.parse(text) : []
}

const entities = await restGet('entities', {
  select: 'id,api_name',
  deleted_at: 'is.null',
  order: 'api_name.asc',
})
if (!Array.isArray(entities) || entities.length === 0) {
  console.error('FAIL: entities empty under anon — apply 202609030002_registry_anon_select.sql')
  process.exit(1)
}

const ids = entities.map((row) => row.id).filter(Boolean)
const inFilter = `(${ids.join(',')})`
const [fields, relations] = await Promise.all([
  restGet('fields', {
    select: 'id,entity_id,api_name,interface',
    entity_id: `in.${inFilter}`,
  }),
  restGet('relations', {
    select: 'id,entity_id,kind,field_id',
    entity_id: `in.${inFilter}`,
  }),
])

const m2a = relations.filter((row) => String(row.kind).toUpperCase() === 'M2A').length

console.log(
  `ok: registry REST snapshot entities=${entities.length} fields=${fields.length} relations=${relations.length} m2a=${m2a}`,
)
if (m2a === 0) {
  console.log('note: 0 M2A relations — seed visit.blocks or another list-m2a field')
}
