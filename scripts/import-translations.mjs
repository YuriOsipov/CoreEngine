/**
 * Import translations into Supabase registry from bundled YAML
 * (`src/assets/registry-translations/*.yaml`).
 *
 * Usage:
 *   node --env-file=.env --env-file=supabase/.env ./scripts/import-translations.mjs
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const PG_HOST =
  process.env.POSTGRES_HOST === 'host.docker.internal'
    ? 'localhost'
    : process.env.POSTGRES_HOST || 'localhost'
const PG_PORT = process.env.POSTGRES_PORT || '5434'
const PG_DB = process.env.POSTGRES_DB || 'supabase'
const PG_USER = process.env.POSTGRES_BOOTSTRAP_USER || 'postgres'
const PG_PASSWORD = process.env.POSTGRES_BOOTSTRAP_PASSWORD || process.env.POSTGRES_PASSWORD || '1'

const LANGUAGES = ['en-US', 'uk-UA']

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL'
  return `'${String(value).replace(/'/g, "''")}'`
}

function unquoteYamlValue(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Flat key parser matching src/core/translation.ts */
function parseYamlTranslations(yaml) {
  const translations = new Map()
  const parents = []

  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === '---' || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('- ')) continue

    const indent = line.match(/^\s*/)?.[0].length ?? 0
    const match = trimmed.match(/^([^:#][^:]*):(?:\s*(.*))?$/)
    if (!match) continue

    const key = unquoteYamlValue(match[1].trim())
    const rawValue = match[2]?.trim() ?? ''
    while (parents.length > 0 && parents[parents.length - 1].indent >= indent) {
      parents.pop()
    }

    const path = [...parents.map((parent) => parent.key), key].join('.')
    if (!rawValue || rawValue === '>' || rawValue === '|' || rawValue === '>-' || rawValue === '|-') {
      parents.push({ indent, key })
      continue
    }

    translations.set(path, unquoteYamlValue(rawValue))
  }

  return translations
}

function loadYamlFile(language) {
  const file = join(repoRoot, 'src', 'assets', 'registry-translations', `${language}.yaml`)
  return parseYamlTranslations(readFileSync(file, 'utf8'))
}

function upsertSql(key, language, value, namespace) {
  return `
INSERT INTO public.translation_entries (key, language, value, namespace)
VALUES (${sqlString(key)}, ${sqlString(language)}, ${sqlString(value)}, ${sqlString(namespace)})
ON CONFLICT (key, language) DO UPDATE SET
  value = EXCLUDED.value,
  namespace = EXCLUDED.namespace,
  updated_at = now();`
}

async function main() {
  const lines = ['BEGIN;']
  let yamlCount = 0

  for (const language of LANGUAGES) {
    console.log(`Loading YAML ${language} ...`)
    const yamlMap = loadYamlFile(language)
    for (const [key, value] of yamlMap) {
      lines.push(upsertSql(key, language, value, 'registry'))
      yamlCount += 1
    }
    console.log(`  yaml keys: ${yamlMap.size}`)
  }

  // Seed a few CRM keys for soft-delete UI later
  const crmSeeds = [
    ['en-US', 'common.softDelete', 'Delete'],
    ['en-US', 'common.restore', 'Restore'],
    ['en-US', 'common.trash', 'Trash'],
    ['uk-UA', 'common.softDelete', 'Видалити'],
    ['uk-UA', 'common.restore', 'Відновити'],
    ['uk-UA', 'common.trash', 'Кошик'],
  ]
  for (const [language, key, value] of crmSeeds) {
    lines.push(upsertSql(key, language, value, 'crm'))
  }

  lines.push('COMMIT;')

  const dir = mkdtempSync(join(tmpdir(), 'crm-i18n-'))
  const sqlPath = join(dir, 'import-translations.sql')
  writeFileSync(sqlPath, lines.join('\n'), 'utf8')
  console.log(`Wrote ${sqlPath}`)
  console.log(`YAML rows: ${yamlCount}`)

  const psqlCandidates = [
    'D:\\PostgreSQL\\15\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\12\\bin\\psql.exe',
    'psql',
  ]
  let psql = null
  for (const candidate of psqlCandidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (probe.status === 0) {
      psql = candidate
      break
    }
  }
  if (!psql) throw new Error('psql not found')

  const result = spawnSync(
    psql,
    ['-h', PG_HOST, '-p', String(PG_PORT), '-U', PG_USER, '-d', PG_DB, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath],
    {
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
      encoding: 'utf8',
    },
  )
  if (result.stdout) process.stdout.write(result.stdout.slice(-2000))
  if (result.stderr) process.stderr.write(result.stderr.slice(-2000))
  if (result.status !== 0) throw new Error(`psql failed with exit ${result.status}`)

  console.log('Translation import complete.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
