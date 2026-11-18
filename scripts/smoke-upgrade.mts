/**
 * Upgrade check against the database in .env / supabase/.env.
 *
 * 1. Apply pending kernel SQL (the script behind npm run registry:migrate:node)
 * 2. Run that command again and fail if a file is applied twice
 * 3. Require public.app_flow_dispatches
 * 4. GET the BFF /health (default http://127.0.0.1:4000/health)
 *
 * This mutates the configured database (pending migrations only).
 * It does not restore or replace data.
 *
 * Usage (repo root): npm run registry:smoke-upgrade
 */
import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { loadPgTarget, targetLabel } from './pg-target.mts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(repoRoot, 'crm-bff/package.json'))
const pg = require('pg') as typeof import('pg')

function migrate(): string {
  const tsxCli = resolve(repoRoot, 'crm-bff/node_modules/tsx/dist/cli.mjs')
  const result = spawnSync(
    process.execPath,
    [
      tsxCli,
      '--env-file=.env',
      '--env-file=supabase/.env',
      './scripts/apply-registry-migration.mts',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.status !== 0) {
    const reason = result.error instanceof Error ? result.error.message : ''
    throw new Error(`registry:migrate:node exited ${result.status ?? 'null'} ${reason}\n${output}`)
  }
  return output
}

function appliedFiles(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('-> '))
    .map((line) => line.slice(3).trim())
}

async function main(): Promise<void> {
  const target = loadPgTarget()
  console.log(`Upgrade smoke on ${targetLabel(target)}`)

  const first = migrate()
  const firstApplied = appliedFiles(first)
  console.log(
    firstApplied.length
      ? `pass 1 applied: ${firstApplied.join(', ')}`
      : 'pass 1 applied: (none pending)',
  )

  const second = migrate()
  const secondApplied = appliedFiles(second)
  if (secondApplied.length) {
    throw new Error(
      `Second migrate applied files again: ${secondApplied.join(', ')}. Kernel SQL must be idempotent.`,
    )
  }
  console.log('pass 2 applied: (none — idempotent)')

  const client = new pg.Client({ connectionString: target.connectionString })
  await client.connect()
  try {
    const table = await client.query<{ ok: boolean }>(
      `SELECT to_regclass('public.app_flow_dispatches') IS NOT NULL AS ok`,
    )
    if (!table.rows[0]?.ok) {
      throw new Error('public.app_flow_dispatches is missing after migrate')
    }
    const tracked = await client.query<{ filename: string }>(
      `SELECT filename FROM public.schema_migrations WHERE filename = $1`,
      ['202611180001_flow_dispatches.sql'],
    )
    if (!tracked.rows[0]) {
      throw new Error('schema_migrations is missing 202611180001_flow_dispatches.sql')
    }
  } finally {
    await client.end()
  }
  console.log('schema: app_flow_dispatches present')

  const healthUrl = (process.env.BFF_HEALTH_URL || 'http://127.0.0.1:4000/health').trim()
  let healthOk = false
  let lastError = 'no response'
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(healthUrl)
      const body = (await response.json()) as { ok?: boolean }
      if (response.ok && body.ok === true) {
        healthOk = true
        break
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
  }
  if (!healthOk) {
    throw new Error(`BFF health check failed (${healthUrl}): ${lastError}`)
  }
  console.log(`health: ${healthUrl} ok`)
  console.log('Upgrade smoke passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
