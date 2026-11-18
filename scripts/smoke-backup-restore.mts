/**
 * Backup/restore drill for the database in .env / supabase/.env.
 *
 * 1. pg_dump -Fc of that database
 * 2. pg_restore -l must mention schema_migrations
 * 3. When the role may create databases: restore into coreengine_restore_smoke,
 *    compare schema_migrations counts, drop the scratch database.
 *
 * Does not replace the live database.
 * Requires pg_dump and pg_restore on PATH.
 *
 * Usage (repo root): npm run registry:smoke-backup-restore
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { loadPgTarget, targetLabel } from './pg-target.mts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(repoRoot, 'crm-bff/package.json'))
const pg = require('pg') as typeof import('pg')
const SCRATCH_DB = 'coreengine_restore_smoke'

function pgEnv(target: ReturnType<typeof loadPgTarget>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: target.host,
    PGPORT: String(target.port),
    PGUSER: target.user,
    PGPASSWORD: target.password,
    PGDATABASE: target.database,
  }
}

function clientCandidates(name: string): string[] {
  const found: string[] = []
  const override = process.env[name === 'pg_dump' ? 'PG_DUMP' : 'PG_RESTORE']
  if (override && existsSync(override)) found.push(override)
  if (process.platform === 'win32') {
    const root = 'C:\\Program Files\\PostgreSQL'
    if (existsSync(root)) {
      for (const version of readdirSync(root)) {
        const candidate = join(root, version, 'bin', `${name}.exe`)
        if (existsSync(candidate)) found.push(candidate)
      }
    }
    const local = process.env.LOCALAPPDATA
    if (local) {
      const pgAdmin = join(local, 'Programs', 'pgAdmin 4', 'runtime', `${name}.exe`)
      if (existsSync(pgAdmin)) found.push(pgAdmin)
    }
  }
  found.push(name)
  return found
}

function clientMajor(bin: string): number {
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8' })
  const match = /(\d+)\.\d+/.exec(`${result.stdout ?? ''} ${result.stderr ?? ''}`)
  return match ? Number(match[1]) : 0
}

function resolveBin(name: string): string {
  let best = name
  let bestMajor = -1
  for (const candidate of clientCandidates(name)) {
    const major = clientMajor(candidate)
    if (major > bestMajor) {
      best = candidate
      bestMajor = major
    }
  }
  return best
}

function run(bin: string, args: string[], env: NodeJS.ProcessEnv): string {
  const resolved = resolveBin(bin)
  const result = spawnSync(resolved, args, { encoding: 'utf8', env, shell: false })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new Error(
      `${bin} was not found on PATH. Install PostgreSQL client tools (or set PG_DUMP and PG_RESTORE), then re-run npm run registry:smoke-backup-restore.`,
    )
  }
  if (result.status !== 0) {
    throw new Error(`${bin} ${args.join(' ')} exited ${result.status}\n${output}`)
  }
  return output
}

async function main(): Promise<void> {
  const target = loadPgTarget()
  const dumpBin = resolveBin('pg_dump')
  console.log(`Backup smoke on ${targetLabel(target)}`)
  console.log(`pg_dump: ${dumpBin}`)

  const dir = mkdtempSync(join(tmpdir(), 'coreengine-backup-'))
  const dumpFile = join(dir, 'coreengine-backup.dump')
  const env = pgEnv(target)
  try {
    run('pg_dump', ['-Fc', '-f', dumpFile, target.database], env)
    const listing = run('pg_restore', ['-l', dumpFile], env)
    if (!/schema_migrations/.test(listing) || !/app_flow_dispatches/.test(listing)) {
      throw new Error('pg_restore -l did not list schema_migrations and app_flow_dispatches')
    }
    console.log(`archive: ${dumpFile}`)
    console.log('archive list includes schema_migrations and app_flow_dispatches')

    const client = new pg.Client({ connectionString: target.connectionString })
    await client.connect()
    let canCreate = false
    let liveCount = 0
    try {
      const role = await client.query<{ ok: boolean }>(
        `SELECT (rolsuper OR rolcreatedb) AS ok
         FROM pg_roles
         WHERE rolname = current_user`,
      )
      canCreate = Boolean(role.rows[0]?.ok)
      const counted = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM public.schema_migrations`,
      )
      liveCount = Number(counted.rows[0]?.n ?? '0')
    } finally {
      await client.end()
    }

    const restoreTarget = target
    if (!canCreate) {
      console.log(
        'restore drill skipped: this role cannot CREATE DATABASE. Archive listing was verified. A superuser can follow docs/backup-restore.md to restore.',
      )
      console.log('Backup smoke passed (archive only).')
      return
    }

    const maintenance = target.database === 'postgres' ? 'template1' : 'postgres'
    const maintClient = new pg.Client({
      host: restoreTarget.host,
      port: restoreTarget.port,
      user: restoreTarget.user,
      password: restoreTarget.password,
      database: maintenance,
    })
    await maintClient.connect()
    try {
      await maintClient.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [SCRATCH_DB],
      )
      await maintClient.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
      await maintClient.query(`CREATE DATABASE ${SCRATCH_DB}`)
    } finally {
      await maintClient.end()
    }
    const restoreEnv = pgEnv(restoreTarget)
    const restoreBin = resolveBin('pg_restore')
    const restoredRun = spawnSync(
      restoreBin,
      ['--no-owner', '--no-privileges', '-d', SCRATCH_DB, dumpFile],
      { encoding: 'utf8', env: restoreEnv },
    )
    const restoreOutput = `${restoredRun.stdout ?? ''}\n${restoredRun.stderr ?? ''}`
    if (restoredRun.status !== 0 && !/transaction_timeout/i.test(restoreOutput)) {
      throw new Error(`pg_restore exited ${restoredRun.status}\n${restoreOutput}`)
    }

    const restored = new pg.Client({
      host: restoreTarget.host,
      port: restoreTarget.port,
      user: restoreTarget.user,
      password: restoreTarget.password,
      database: SCRATCH_DB,
    })
    await restored.connect()
    let restoredCount = 0
    try {
      const counted = await restored.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM public.schema_migrations`,
      )
      restoredCount = Number(counted.rows[0]?.n ?? '0')
    } finally {
      await restored.end()
    }
    if (restoredCount !== liveCount) {
      throw new Error(
        `Restored schema_migrations count ${restoredCount} != live ${liveCount}`,
      )
    }
    console.log(`restore drill: ${SCRATCH_DB} schema_migrations=${restoredCount}`)

    const dropClient = new pg.Client({
      host: restoreTarget.host,
      port: restoreTarget.port,
      user: restoreTarget.user,
      password: restoreTarget.password,
      database: maintenance,
    })
    await dropClient.connect()
    try {
      await dropClient.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [SCRATCH_DB],
      )
      await dropClient.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`)
    } finally {
      await dropClient.end()
    }
    console.log(`dropped scratch database ${SCRATCH_DB}`)
    console.log('Backup smoke passed (dump, list, restore, drop).')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
