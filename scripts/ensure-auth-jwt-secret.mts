/**
 * Ensure AUTH_JWT_SECRET in repo .env / supabase/.env is unique (not an example placeholder).
 *
 * Usage (repo root):
 *   npx --prefix ./crm-bff tsx ./scripts/ensure-auth-jwt-secret.mts
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isInsecureJwtSecret,
  KNOWN_INSECURE_JWT_SECRETS,
} from '../crm-bff/src/auth/jwt.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const rootEnv = resolve(repoRoot, '.env')
const supabaseEnv = resolve(repoRoot, 'supabase/.env')

function readEnvValue(filePath: string, key: string): string {
  if (!existsSync(filePath)) return ''
  const text = readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    if (trimmed.slice(0, eq).trim() !== key) continue
    return trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return ''
}

function upsertEnvValue(filePath: string, key: string, value: string): void {
  const line = `${key}=${value}`
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${line}\n`, 'utf8')
    return
  }
  const text = readFileSync(filePath, 'utf8')
  const lines = text.split(/\r?\n/)
  let found = false
  const next = lines.map((entry) => {
    const trimmed = entry.trim()
    if (!trimmed || trimmed.startsWith('#')) return entry
    const eq = trimmed.indexOf('=')
    if (eq < 0) return entry
    if (trimmed.slice(0, eq).trim() !== key) return entry
    found = true
    return line
  })
  if (!found) {
    if (next.length && next[next.length - 1] !== '') next.push('')
    next.push(line)
  }
  writeFileSync(filePath, `${next.join('\n').replace(/\n+$/, '\n')}`, 'utf8')
}

let current =
  readEnvValue(rootEnv, 'AUTH_JWT_SECRET') ||
  readEnvValue(supabaseEnv, 'AUTH_JWT_SECRET') ||
  (process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || '').trim()

const needsGenerate = !current || isInsecureJwtSecret(current)
const secret = needsGenerate ? randomBytes(32).toString('base64url') : current

upsertEnvValue(rootEnv, 'AUTH_JWT_SECRET', secret)
console.log(`ok: AUTH_JWT_SECRET ${needsGenerate ? 'generated into' : 'kept in'} ${rootEnv}`)

if (existsSync(supabaseEnv)) {
  upsertEnvValue(supabaseEnv, 'AUTH_JWT_SECRET', secret)
  console.log(
    `ok: AUTH_JWT_SECRET ${needsGenerate ? 'generated into' : 'kept in'} ${supabaseEnv}`,
  )
}

if (needsGenerate) {
  console.log(
    'Generated a unique AUTH_JWT_SECRET (not printed). Re-copying example env files resets it — re-run provision / this script.',
  )
}

for (const bad of KNOWN_INSECURE_JWT_SECRETS) {
  if (!isInsecureJwtSecret(bad)) {
    throw new Error(`isInsecureJwtSecret failed to flag placeholder: ${bad}`)
  }
}
