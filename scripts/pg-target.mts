/**
 * Same host/db resolution as scripts/apply-registry-migration.mts.
 * Does not connect and does not print the password.
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(repoRoot, 'crm-bff/package.json'))
const { config: loadEnv } = require('dotenv') as typeof import('dotenv')

loadEnv({ path: resolve(repoRoot, '.env') })
loadEnv({
  path: resolve(repoRoot, 'supabase/.env'),
  override: process.env.RUNNING_IN_DOCKER !== '1',
})

function env(name: string, fallback = ''): string {
  return String(process.env[name] ?? fallback).trim()
}

export interface PgTarget {
  host: string
  port: number
  database: string
  user: string
  password: string
  connectionString: string
}

export function loadPgTarget(): PgTarget {
  const hostRaw = env('POSTGRES_HOST', 'localhost')
  const host =
    hostRaw === 'host.docker.internal' && !env('RUNNING_IN_DOCKER') ? 'localhost' : hostRaw
  const port = Number(env('POSTGRES_PORT', '5432') || 5432)
  const database = env('POSTGRES_DB', 'coreengine')
  const user = env('POSTGRES_BOOTSTRAP_USER') || env('POSTGRES_USER') || 'postgres'
  const password =
    env('POSTGRES_BOOTSTRAP_PASSWORD') || env('POSTGRES_PASSWORD') || 'postgres'
  const connectionString =
    env('DATABASE_URL') ||
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
  return { host, port, database, user, password, connectionString }
}

export function targetLabel(target: PgTarget): string {
  return `${target.host}:${target.port}/${target.database} as ${target.user}`
}
