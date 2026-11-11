/**
 * Cross-platform provision: kernel SQL + documents pack + optional vertical pack.
 *
 * Usage (repo root):
 *   npm run platform:provision:node -- --domain sales
 *   npm run platform:provision:node -- --domain none --admin-password 'ChangeMeNow!'
 *
 * Docker (see docker-compose.yml): Postgres + BFF, optional web profile.
 *   docker compose run --rm --workdir /app bff npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env ./scripts/provision-platform-db.mts --domain sales
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function argValue(flag: string, fallback = ''): string {
  const idx = process.argv.indexOf(flag)
  if (idx < 0 || idx + 1 >= process.argv.length) return fallback
  return String(process.argv[idx + 1] || '').trim() || fallback
}

const domain = (argValue('--domain', 'none') || 'none').toLowerCase()
const adminEmail = argValue('--admin-email', 'admin@example.com')
const adminPassword = argValue('--admin-password', 'admin12345')

const allowed = new Set(['none', 'sales', 'clinic', 'pricing', 'documents'])
if (!allowed.has(domain)) {
  throw new Error(`Invalid --domain ${domain}. Expected one of: ${[...allowed].join(', ')}`)
}

if (!existsSync(resolve(repoRoot, 'supabase/.env'))) {
  throw new Error(
    'Missing supabase/.env — copy from .env.docker.example / supabase/.env.example and point at the target DB.',
  )
}

function runTsx(label: string, scriptRel: string, extra: string[] = []): void {
  console.log(`==> ${label}`)
  const result = spawnSync(
    'npx',
    [
      '--prefix',
      './crm-bff',
      'tsx',
      '--env-file=.env',
      '--env-file=supabase/.env',
      scriptRel,
      ...extra,
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: true,
      env: process.env,
    },
  )
  if (result.status !== 0) {
    throw new Error(`${label} failed`)
  }
}

runTsx('1/4 Kernel SQL (supabase/migrations)', './scripts/apply-registry-migration.mts')
runTsx('2/4 Admin password', './scripts/set-user-password.mts', [adminEmail, adminPassword])
runTsx('3/4 Documents pack', './scripts/apply-domain-pack.mts', ['documents'])

if (domain !== 'none' && domain !== 'documents') {
  runTsx(`4/4 Domain pack: ${domain}`, './scripts/apply-domain-pack.mts', [domain])
} else {
  console.log('==> 4/4 Vertical domain pack: skipped')
}

console.log('')
console.log('Provision complete.')
console.log(`  Login: ${adminEmail} / (password you set)`)
console.log('  Next: npm run bff:dev && npm run dev   (or: docker compose up -d bff)')
if (domain === 'none') {
  console.log('  Or apply a pack later: npm run platform:apply-pack -- sales')
}
