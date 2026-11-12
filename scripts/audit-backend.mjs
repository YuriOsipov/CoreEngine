#!/usr/bin/env node
/**
 * audit-backend.mjs — static security audit for the CoreEngine BFF (Node/TypeScript).
 *
 *   node scripts/audit-backend.mjs                      # audit ./crm-bff/src (or ./src)
 *   node scripts/audit-backend.mjs --src crm-bff/src --root .
 *   node scripts/audit-backend.mjs --deps               # + `npm audit --omit=dev` (needs network)
 *   node scripts/audit-backend.mjs --json > audit.json
 *   node scripts/audit-backend.mjs --fail-on medium     # exit 1 on MEDIUM or worse (default: high)
 *
 * No dependencies. It never imports or runs your app (no DB, no env needed).
 *
 * WHAT IT CHECKS
 *  1. GUARDS      every GraphQL Query/Mutation and REST route calls a guard (or is allowlisted)
 *  2. FIELD SEC   regression checks for known field-level-security leak paths
 *                 (dotted filter keys, computed fields, related-entity search, unredacted write results)
 *  3. CODE LINTS  unsigned JWT decode, VITE_* env in backend, eval, weak randomness, TLS off,
 *                 hard-coded default passwords, fail-open identity checks, secrets in logs, ...
 *  4. SQL         dynamic SQL in template literals whose ${…} is not an obvious safe helper (review list)
 *  5. DEPLOY      docker-compose ports published on all interfaces, example env files, lockfiles
 *  6. DEPS        optional npm audit
 *
 * SUPPRESS A FINDING (with a reason) on the same or previous line:
 *     // audit-ignore: RULE-ID because …
 *   (for SQL-DYNAMIC put it above the `query(` line, since a comment cannot live inside the SQL string)
 * OVERRIDE ALLOWLISTS: put audit-backend.config.json next to where you run it:
 *     { "publicGraphql": ["Query.foo"], "publicRest": ["GET /x"], "authOnlyMutations": [],
 *       "authOnlyRest": [], "safeSql": ["myHelper"], "ignorePaths": ["legacy/"], "ignoreRules": ["CORS-WILDCARD"] }
 *
 * HONEST LIMITS: static and heuristic. It proves a guard is *called*, not that it is the right one or
 * runs before data access; it cannot see global hooks, DB migrations, RLS, or runtime config. A clean run
 * is a safety net against "someone forgot", not a security proof. Pair it with integration tests.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, basename } from 'node:path'
import { spawnSync } from 'node:child_process'

// ─────────────────────────── configuration ───────────────────────────
const CONFIG = {
  routerNames: ['app', 'fastify', 'server', 'router', 'instance'],

  /** Any of these appearing as a call counts as a guard. */
  guards: {
    admin: [/\brequireAdminAccess\s*\(/],
    selfOrAdmin: [/\brequireSelfOrAdmin\s*\(/],
    permission: [
      /\bassertEntityPermission\s*\(/,
      /\bassertMeEntityPermission\s*\(/,
      /\bassertUpsertPermissions\s*\(/,
      /\bassertFileReadable\s*\(/,
      /\bassertFilesReadable\s*\(/,
      /\bassertFileWritable\s*\(/,
      /\bassertFileParentWritable\s*\(/,
    ],
    /** Authorization is delegated to a function in another file (verify it by hand once). */
    delegated: [/\bauthorizeFlowTrigger\s*\(/, /\btriggerFlow\s*\(/],
    authenticated: [/\brequireAuthenticatedUser\s*\(/, /\brequireAuth\s*\(/],
  },

  publicGraphql: ['Query.health', 'Query.languages', 'Query.translations', 'Query.translate'],
  authOnlyMutations: ['Mutation.generateDocument'],
  publicRest: ['GET /health', 'POST /auth/login', 'POST /auth/refresh', 'POST /auth/logout'],
  authOnlyRest: ['POST /auth/change-password'],

  /** Files allowed to touch password hashes. */
  passwordHashAllowed: [/auth\/(localAuth|passwords|bootstrapPasswordGuard)/, /userAdminService/, /postgresUsers/],
  /** ${…} expressions in SQL templates treated as safe (helpers / placeholders). */
  safeSql: [
    /\bquoteIdent\s*\(/, /\bquoteLiteral\s*\(/, /Sql\b/, /\bSQL\b/, /\bsql\b/, /\.join\(/,
    /^\s*(next|index|idx|i|n|limit|offset|placeholder\w*|cols?|columns?|alias|table|relation\w*)\s*$/i,
    /^\s*\$?\{?\s*\w+\s*\+\s*\d+\s*$/,
    /^[A-Z][A-Z0-9_]+$/, /\.length\b/, /^select\w*\(/i, /Select\b/,
  ],
  ignorePaths: [],
  ignoreRules: [],
}

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const ROOT = resolve(opt('--root', process.cwd()))
const JSON_OUT = flag('--json')
const DEPS = flag('--deps')
const FAIL_ON = (opt('--fail-on', flag('--strict') ? 'medium' : 'high') || 'high').toLowerCase()

// optional config override
for (const candidate of [opt('--config', ''), join(ROOT, 'audit-backend.config.json')].filter(Boolean)) {
  if (!existsSync(candidate)) continue
  try {
    const user = JSON.parse(readFileSync(candidate, 'utf8'))
    for (const key of ['publicGraphql', 'publicRest', 'authOnlyMutations', 'authOnlyRest', 'ignorePaths', 'ignoreRules']) {
      if (Array.isArray(user[key])) CONFIG[key] = [...new Set([...CONFIG[key], ...user[key]])]
    }
    if (Array.isArray(user.safeSql)) CONFIG.safeSql.push(...user.safeSql.map((s) => new RegExp(`\\b${s}\\b`)))
  } catch (error) {
    console.error(`Could not read ${candidate}: ${error.message}`)
  }
}

const allGuards = Object.values(CONFIG.guards).flat()
const matchesAny = (text, patterns) => patterns.some((p) => p.test(text))


/**
 * Blank out comments, strings, template-literal text and regex literals while
 * keeping every index identical, so brace matching and guard detection only see
 * real code. Template `${…}` expressions are kept as code.
 */
function maskSource(src) {
  const out = src.split('')
  const n = src.length
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '
  }
  let i = 0
  let prevSig = '' // previous significant character (for regex-literal detection)
  const regexAllowedAfter = new Set([
    '', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^',
  ])

  const readQuoted = (q) => {
    const start = i
    i++
    while (i < n) {
      const c = src[i]
      if (c === '\\') { i += 2; continue }
      if (c === q || c === '\n') { i++; break }
      i++
    }
    blank(start, i)
  }

  const readRegex = () => {
    const start = i
    i++
    let inClass = false
    while (i < n) {
      const r = src[i]
      if (r === '\\') { i += 2; continue }
      if (r === '[') inClass = true
      else if (r === ']') inClass = false
      else if (r === '/' && !inClass) { i++; break }
      else if (r === '\n') break
      i++
    }
    while (i < n && /[a-z]/i.test(src[i])) i++
    blank(start, i)
  }

  const readTemplate = () => {
    let segStart = i // current text segment (starts at the opening backtick)
    i++
    while (i < n) {
      const c = src[i]
      if (c === '\\') { i += 2; continue }
      if (c === '`') { i++; blank(segStart, i); return }
      if (c === '$' && src[i + 1] === '{') {
        i += 2
        blank(segStart, i) // text plus the "${"
        let depth = 1
        let exprPrev = '('
        while (i < n && depth > 0) {
          const d = src[i]
          if (d === '{') { depth++; exprPrev = d; i++ }
          else if (d === '}') { depth--; if (depth === 0) break; exprPrev = d; i++ }
          else if (d === '`') { readTemplate(); exprPrev = 'x' }
          else if (d === '"' || d === "'") { readQuoted(d); exprPrev = 'x' }
          else if (d === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && regexAllowedAfter.has(exprPrev)) { readRegex(); exprPrev = 'x' }
          else { if (!/\s/.test(d)) exprPrev = d; i++ }
        }
        segStart = i // the closing "}" starts the next text segment
        i++
        continue
      }
      i++
    }
    blank(segStart, n)
  }

  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      const start = i
      while (i < n && src[i] !== '\n') i++
      blank(start, i)
      continue
    }
    if (c === '/' && next === '*') {
      const start = i
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      blank(start, i)
      continue
    }
    if (c === '"' || c === "'") { readQuoted(c); prevSig = 'x'; continue }
    if (c === '`') { readTemplate(); prevSig = 'x'; continue }
    if (c === '/' && regexAllowedAfter.has(prevSig)) { readRegex(); prevSig = 'x'; continue }
    if (!/\s/.test(c)) prevSig = c
    i++
  }
  return out.join('')
}

/** Index of the bracket matching the opener at `open` (in masked text), or -1. */
function matchBracket(masked, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' }
  const stack = []
  for (let i = open; i < masked.length; i++) {
    const c = masked[i]
    if (pairs[c]) stack.push(pairs[c])
    else if (c === '}' || c === ')' || c === ']') {
      if (stack.pop() !== c) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}

/** Split masked text by commas that are at bracket depth 0. Returns [start,end) pairs. */
function splitTopLevel(masked, from, to) {
  const parts = []
  let depth = 0
  let start = from
  for (let i = from; i < to; i++) {
    const c = masked[i]
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      parts.push([start, i])
      start = i + 1
    }
  }
  if (masked.slice(start, to).trim()) parts.push([start, to])
  return parts
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length

/** Find the body text of a same-file helper (function or arrow const) by name. */
function helperBody(masked, name) {
  const re = new RegExp(`(?:\\bfunction\\s+${name}\\b|\\b(?:const|let|var)\\s+${name}\\b)`)
  const m = re.exec(masked)
  if (!m) return null
  let i = m.index + m[0].length
  // function declaration: params then body; arrow: params => body
  const arrow = masked.indexOf('=>', i)
  const paren = masked.indexOf('(', i)
  let braceFrom = i
  if (/^\bfunction\b/.test(m[0]) && paren >= 0) {
    const closeParen = matchBracket(masked, paren)
    if (closeParen < 0) return null
    braceFrom = closeParen
  } else if (arrow >= 0) {
    braceFrom = arrow + 2
  }
  const open = masked.indexOf('{', braceFrom)
  if (open < 0) return null
  const close = matchBracket(masked, open)
  if (close < 0) return null
  return masked.slice(open, close + 1)
}

/** Handler text plus bodies of same-file helpers it calls (two levels deep). */
function withHelpers(masked, text, depth = 2, seen = new Set()) {
  if (depth === 0) return text
  let combined = text
  const calls = new Set()
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(m[1])
  // bare handler references like `app.put('/x', updateHandler)`
  for (const m of text.matchAll(/,\s*([A-Za-z_$][\w$]*)\s*\)\s*$/g)) calls.add(m[1])
  for (const name of calls) {
    if (seen.has(name) || allGuards.some((p) => p.test(`${name}(`))) continue
    seen.add(name)
    const body = helperBody(masked, name)
    if (body) combined += '\n' + withHelpers(masked, body, depth - 1, seen)
  }
  return combined
}


// ─────────────────────────── findings & file loading ───────────────────────────
const SEV = { HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 }
const findings = []
const stats = { files: 0, graphql: 0, rest: 0 }

function classify(text) {
  if (matchesAny(text, CONFIG.guards.admin)) return 'admin'
  if (matchesAny(text, CONFIG.guards.selfOrAdmin)) return 'self-or-admin'
  if (matchesAny(text, CONFIG.guards.permission)) return 'permission'
  if (matchesAny(text, CONFIG.guards.delegated)) return 'delegated'
  if (matchesAny(text, CONFIG.guards.authenticated)) return 'auth-only'
  return 'none'
}

function suppressed(file, line, rule) {
  const re = new RegExp(`audit-ignore:\\s*(?:all|${rule})\\b`)
  return re.test(file.lines[line - 1] ?? '') || re.test(file.lines[line - 2] ?? '')
}

function add(sev, rule, file, line, msg, anchor) {
  if (CONFIG.ignoreRules.includes(rule)) return
  if (file?.rel && CONFIG.ignorePaths.some((p) => file.rel.includes(p))) return
  if (file?.lines && line && suppressed(file, line, rule)) return
  if (file?.lines && anchor && suppressed(file, anchor, rule)) return
  findings.push({ sev, rule, file: file?.rel ?? null, line: line ?? null, msg })
}

function findSrcDir() {
  const explicit = opt('--src', '')
  if (explicit) return resolve(ROOT, explicit)
  for (const candidate of ['crm-bff/src', 'src']) {
    const p = join(ROOT, candidate)
    if (existsSync(p)) return p
  }
  return null
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.git')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(name) && !/\.(test|spec)\.|\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

const SRC = findSrcDir()
if (!SRC || !existsSync(SRC)) {
  console.error('Source directory not found. Use --src <dir> (e.g. --src crm-bff/src).')
  process.exit(2)
}
const files = walk(SRC).map((abs) => {
  const raw = readFileSync(abs, 'utf8').replace(/\r/g, '')
  return { abs, rel: relative(ROOT, abs).replace(/\\/g, '/'), raw, masked: maskSource(raw), lines: raw.split('\n') }
})
stats.files = files.length

/** [start, end) of a same-file function/arrow body, or null. */
function helperSpan(masked, name) {
  const re = new RegExp(`(?:\\bfunction\\s+${name}\\b|\\b(?:const|let|var)\\s+${name}\\b)`)
  const m = re.exec(masked)
  if (!m) return null
  const i = m.index + m[0].length
  let braceFrom = i
  if (/^function\b/.test(m[0])) {
    const paren = masked.indexOf('(', i)
    const close = paren >= 0 ? matchBracket(masked, paren) : -1
    if (close < 0) return null
    braceFrom = close
  } else {
    const arrow = masked.indexOf('=>', i)
    if (arrow >= 0) braceFrom = arrow + 2
  }
  const open = masked.indexOf('{', braceFrom)
  if (open < 0) return null
  const end = matchBracket(masked, open)
  return end < 0 ? null : [open, end + 1]
}

// ───────────────────────────── 1. GUARDS ─────────────────────────────
const seenPublic = new Set()

function auditGraphql(file) {
  const { raw, masked } = file
  for (const section of ['Query', 'Mutation']) {
    const re = new RegExp(`\\b${section}\\s*:\\s*\\{`, 'g')
    let m
    while ((m = re.exec(masked))) {
      const open = m.index + m[0].length - 1
      const close = matchBracket(masked, open)
      if (close < 0) continue
      for (const [a, b] of splitTopLevel(masked, open + 1, close)) {
        const chunk = masked.slice(a, b)
        const nm = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?::|\(|$)/.exec(chunk)
        if (!nm) continue
        const id = `${section}.${nm[1]}`
        const line = lineOf(raw, a + chunk.search(/\S/))
        stats.graphql++
        const kind = classify(withHelpers(masked, chunk))
        if (CONFIG.publicGraphql.includes(id)) {
          seenPublic.add(id)
          continue
        }
        if (kind === 'none') {
          const bareRef = !/[({]/.test(chunk.replace(/^\s*[\w$]+\s*:/, ''))
          if (bareRef) add('LOW', 'GUARD-UNINSPECTABLE', file, line, `${id} delegates to a reference this script cannot inspect`)
          else add('HIGH', 'GUARD-GRAPHQL', file, line, `${id} has NO guard (requireAdminAccess / assertEntityPermission / requireAuthenticatedUser), and is not allowlisted as public`)
        } else if (kind === 'auth-only' && section === 'Mutation' && !CONFIG.authOnlyMutations.includes(id)) {
          add('LOW', 'GUARD-AUTH-ONLY', file, line, `${id} is protected by authentication only (any logged-in user can call it) — confirm that is intended`)
        }
      }
    }
  }
}

const ROUTE_RE = new RegExp(`\\b(?:${CONFIG.routerNames.join('|')})\\s*\\.\\s*(get|post|put|patch|delete|all)\\s*(?=[<(])`, 'g')

function auditRest(file) {
  const { raw, masked } = file
  ROUTE_RE.lastIndex = 0
  let m
  while ((m = ROUTE_RE.exec(masked))) {
    const method = m[1].toUpperCase()
    let i = m.index + m[0].length
    if (masked[i] === '<') {
      let depth = 0
      for (; i < masked.length; i++) {
        const c = masked[i]
        if (c === '<') depth++
        else if (c === '>' && masked[i - 1] !== '=') {
          depth--
          if (depth === 0) { i++; break }
        }
      }
    }
    while (/\s/.test(masked[i] ?? '')) i++
    if (masked[i] !== '(') continue
    const close = matchBracket(masked, i)
    if (close < 0) continue
    const pathMatch = /^\(\s*(['"`])([^'"`]+)\1/.exec(raw.slice(i, close + 1))
    if (!pathMatch) continue
    const id = `${method} ${pathMatch[2]}`
    const line = lineOf(raw, m.index)
    stats.rest++
    const kind = classify(withHelpers(masked, masked.slice(i, close + 1)))
    if (CONFIG.publicRest.includes(id)) {
      seenPublic.add(id)
      continue
    }
    if (kind === 'none') add('HIGH', 'GUARD-REST', file, line, `${id} has NO guard (requireAuth / assertEntityPermission / assertFile*), and is not allowlisted as public`)
    else if (kind === 'auth-only' && method !== 'GET' && !CONFIG.authOnlyRest.includes(id)) {
      add('LOW', 'GUARD-AUTH-ONLY', file, line, `${id} is protected by authentication only — confirm no entity permission is needed`)
    }
  }
}

for (const file of files) {
  if (/\b(Query|Mutation)\s*:\s*\{/.test(file.masked)) auditGraphql(file)
  auditRest(file)
}
for (const id of [...CONFIG.publicGraphql, ...CONFIG.publicRest]) {
  if (!seenPublic.has(id)) add('INFO', 'ALLOWLIST-STALE', null, null, `Allowlist entry "${id}" matched nothing in ${relative(ROOT, SRC)} (route may live in another package)`)
}

// ───────────────────────────── 3. CODE LINTS ─────────────────────────────
const LINE_RULES = [
  { id: 'AUTH-UNSIGNED-JWT', sev: 'HIGH', scope: 'raw', skip: /auth\/jwt\.[tj]s$/,
    re: /\bdecodeJwtClaims\b|\.split\(\s*['"]\.['"]\s*\)\s*\[\s*1\s*\]/,
    msg: 'JWT payload decoded without verifying the signature — forgeable claims must never establish identity (use verifyAccessToken)' },
  { id: 'ENV-VITE-SECRET', sev: 'HIGH', scope: 'raw',
    re: /(?:process\.env|import\.meta\.env)\.VITE_\w*(?:TOKEN|SECRET|PASSWORD|SERVICE_ROLE|PRIVATE)\w*/,
    msg: 'a secret is read from a VITE_* variable — Vite inlines VITE_* into the browser bundle, so defining it publishes the secret. Use a server-only name.' },
  { id: 'ENV-VITE', sev: 'LOW', scope: 'raw',
    re: /(?:process\.env|import\.meta\.env)\.VITE_(?!\w*(?:TOKEN|SECRET|PASSWORD|SERVICE_ROLE|PRIVATE))\w+/,
    msg: 'backend falls back to a VITE_* variable (public by design, but the backend should use server-side names only)' },
  { id: 'ENV-STATIC-TOKEN', sev: 'MEDIUM', scope: 'raw', skip: /directus\//, re: /process\.env\.DIRECTUS_(STATIC_)?TOKEN/,
    msg: 'static backend credential read outside its adapter — must never act as a user identity' },
  { id: 'HARDCODED-SECRET', sev: 'MEDIUM', scope: 'raw', skip: /insecurePasswords|bootstrapPasswordGuard/,
    re: /admin12345|ChangeMeNow|changeme|password123/i, msg: 'well-known default password/secret in source' },
  { id: 'WEAK-RANDOM', sev: 'MEDIUM', scope: 'code', onlyPaths: /(^|\/)(auth|flows|files)\/|userAdmin|token|session/i, re: /Math\.random\s*\(/,
    msg: 'Math.random() in a security-sensitive path — use crypto.randomBytes / randomUUID' },
  { id: 'TLS-DISABLED', sev: 'HIGH', scope: 'raw', re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/,
    msg: 'TLS certificate verification disabled' },
  { id: 'DYNAMIC-EVAL', sev: 'HIGH', scope: 'code', re: /\beval\s*\(|\bnew\s+Function\s*\(|\bvm\.(runIn\w+|Script)\b/,
    msg: 'dynamic code evaluation (formulas/templates must use a real expression parser, not eval)' },
  { id: 'CHILD-PROCESS', sev: 'MEDIUM', scope: 'raw', re: /['"](?:node:)?child_process['"]/,
    msg: 'child_process in the server — confirm no user-controlled input reaches it' },
  { id: 'CORS-WILDCARD', sev: 'LOW', scope: 'raw', needsText: /cors/i, re: /origin\s*:\s*(?:true|['"]\*['"])|includes\(\s*['"]\*['"]\s*\)/,
    msg: 'CORS wildcard / reflect-any-origin is possible — refuse it in production' },
  { id: 'LOG-SECRETS', sev: 'LOW', scope: 'code', re: /console\.\w+\([^)]*\b(?:password|passwd|secret|authorization|refreshToken|accessToken|refresh_token|access_token|jwt)\b/i,
    msg: 'a credential-named variable is passed to a log call' },
  { id: 'PASSWORD-HASH-OUTSIDE-AUTH', sev: 'MEDIUM', scope: 'raw', skipFn: (rel) => CONFIG.passwordHashAllowed.some((p) => p.test(rel)),
    re: /password_hash|passwordHash/, msg: 'password hash referenced outside the auth modules' },
  { id: 'FAIL-OPEN-IDENTITY', sev: 'MEDIUM', scope: 'code', onlyPaths: /(rolePermissions|fieldSecurity|accessGuards|records\/facade)/,
    re: /if\s*\(\s*!\s*(?:access\??\.)?me\s*\)\s*return\b/,
    msg: 'a missing identity is treated as "system caller / allowed" — a call site that forgets to pass `me` silently skips the check (make it required, with an explicit SYSTEM value)' },
  { id: 'OPTIONAL-ACCESS-PARAM', sev: 'LOW', scope: 'code', aggregate: true, onlyPaths: /records\/facade/, re: /\baccess\?\s*:\s*RecordAccess/,
    msg: 'facade functions take an OPTIONAL `access` — security is opt-in per call site' },
  { id: 'FAIL-OPEN-SCHEMA', sev: 'LOW', scope: 'code', aggregate: true, onlyPaths: /fieldSecurity/, re: /isMissingColumnError\s*\(/,
    msg: 'feature disables itself (warning only) when its DB columns are missing — fail closed / refuse to start in production' },
]

for (const file of files) {
  const maskedLines = file.masked.split('\n')
  for (const rule of LINE_RULES) {
    if (rule.skip?.test(file.rel) || rule.skipFn?.(file.rel)) continue
    if (rule.onlyPaths && !rule.onlyPaths.test(file.rel)) continue
    if (rule.needsText && !rule.needsText.test(file.raw)) continue
    const lines = rule.scope === 'code' ? maskedLines : file.lines
    const hits = []
    lines.forEach((text, i) => {
      if (rule.scope !== 'code') {
        const t = text.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
      }
      if (rule.re.test(text)) hits.push(i + 1)
    })
    if (!hits.length) continue
    if (rule.aggregate) {
      const shown = hits.slice(0, 8).join(', ') + (hits.length > 8 ? ', …' : '')
      add(rule.sev, rule.id, file, hits[0], `${rule.msg} (${hits.length}×: lines ${shown})`)
    } else {
      for (const line of hits) add(rule.sev, rule.id, file, line, rule.msg)
    }
  }
}

// ───────────────────────────── 4. SQL (review list) ─────────────────────────────
for (const file of files) {
  const re = /\b(?:query|pool\.query|client\.query|tx)\s*(?:<[^`()]*>)?\s*\(\s*`([^`]*)`/g
  let m
  while ((m = re.exec(file.raw))) {
    const bodyStart = m.index + m[0].indexOf('`') + 1
    for (const e of m[1].matchAll(/\$\{([^}]*)\}/g)) {
      const expr = e[1].trim()
      if (CONFIG.safeSql.some((p) => p.test(expr))) continue
      add('LOW', 'SQL-DYNAMIC', file, lineOf(file.raw, bodyStart + e.index),
        `dynamic SQL \${${expr.slice(0, 60)}} — confirm it is a quoted identifier / validated constant, never user input (values must be $n parameters). Suppress with a comment above the query( line.`,
        lineOf(file.raw, m.index))
    }
  }
}

// ───────────────────────────── 2. FIELD-LEVEL SECURITY regressions ─────────────────────────────
const fieldSecurityActive = files.some((f) => /\bresolveFieldAccess\b/.test(f.raw) && /\bsensitivity\b/.test(f.raw))

for (const f of files) {
  // 2a. dotted filter keys must be walked hop by hop
  if (/function\s+assertFilterReadable\b/.test(f.masked)) {
    const span = helperSpan(f.masked, 'assertFilterReadable')
    if (span) {
      const body = f.raw.slice(span[0], span[1])
      if (!/includes\(\s*['"]\.['"]\s*\)|assertFieldPathReadable|split\(\s*['"]\.['"]\s*\)/.test(body)) {
        add('HIGH', 'FS-DOTTED-FILTER', f, lineOf(f.raw, span[0]),
          'filter keys containing a dot ("manager.salary" — emitted by SOQL and honoured by the SQL store as an EXISTS on the related table) are not checked, so a role that cannot read a restricted field can still binary-search it with a filter. Walk the path with assertFieldPathReadable().')
      }
    }
  }
  // 2b. related-entity search must respect restrictions on the related entity
  if (/function\s+m2oSearchExistsSql\b/.test(f.masked)) {
    const span = helperSpan(f.masked, 'm2oSearchExistsSql')
    if (span) {
      const body = f.raw.slice(span[0], span[1])
      if (!/unreadable|resolveFieldAccess|assertMeEntityPermission|canRead|searchExclude/.test(body)) {
        add('MEDIUM', 'FS-RELATED-SEARCH', f, lineOf(f.raw, span[0]),
          'list `search` through M2O "Use in search" matches the related row\'s display-template fields without checking the caller\'s read access / restricted fields on the RELATED entity (search oracle)')
      }
    }
  }
}

// 2c. computed fields (formula / rollup / template) vs sensitivity
if (fieldSecurityActive) {
  const computed = files.filter((f) => /(^|\/)computed\//.test(f.rel) && /apply(Rollups|Formulas)|computedTemplate/.test(f.rel))
  if (computed.length && !computed.some((f) => /sensitiv|fieldSecurity|resolveFieldAccess/.test(f.raw))) {
    add('MEDIUM', 'FS-COMPUTED-FIELDS', computed[0], 1,
      'formula / rollup / template fields are computed without any field-level-security handling — a derived value (e.g. SUM of a restricted column) can reach roles that cannot read the source. Make computed fields inherit the highest source tier, or refuse to save a lower one.')
  }
}

// 2d. results of facade writes must be redacted at API boundaries
const BOUNDARY = /(^|\/)(rest|resolvers|flows)\//
if (fieldSecurityActive) {
  for (const f of files) {
    if (!BOUNDARY.test(f.rel)) continue
    const re = /\b(createRecord|updateRecord|restoreRecord|softDeleteRecord)\s*\(/g
    let m
    while ((m = re.exec(f.masked))) {
      const before = f.masked.slice(Math.max(0, m.index - 40), m.index)
      if (/function\s+$|\.\s*$/.test(before)) continue
      if (/\bredactRecord(ForMe|s)?\s*\(/.test(f.masked.slice(m.index, m.index + 3000))) continue
      add('MEDIUM', 'FS-UNREDACTED-WRITE', f, lineOf(f.raw, m.index),
        `${m[1]}() returns an unredacted record by design; no redactRecord/redactRecordForMe call follows within ~3000 chars (heuristic) — make sure the response is redacted`)
    }
  }
}

// ───────────────────────────── 5. DEPLOY ─────────────────────────────
function auditDeploy() {
  const found = []
  const shallow = (dir, depth = 0) => {
    if (depth > 2 || !existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.git') || name === 'dist') continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) shallow(full, depth + 1)
      else if (/^(docker-)?compose.*\.ya?ml$/i.test(name) || /^\.env.*example$/i.test(name)) found.push(full)
    }
  }
  shallow(ROOT)
  const SENSITIVE_PORTS = new Set([5432, 54320, 54322, 6543, 8080, 8090, 8055, 5678])
  for (const abs of found) {
    const rel = relative(ROOT, abs).replace(/\\/g, '/')
    const raw = readFileSync(abs, 'utf8').replace(/\r/g, '')
    const file = { rel, lines: raw.split('\n') }
    file.lines.forEach((text, i) => {
      const port = /^\s*-\s*["']?(?:(0\.0\.0\.0|\d{1,3}(?:\.\d{1,3}){3}):)?(\d+):(\d+)(?:\/\w+)?["']?\s*(?:#.*)?$/.exec(text)
      if (port && (!port[1] || port[1] === '0.0.0.0') && (SENSITIVE_PORTS.has(Number(port[2])) || SENSITIVE_PORTS.has(Number(port[3])))) {
        add('MEDIUM', 'DEPLOY-PORT-EXPOSED', file, i + 1,
          `port ${port[2]}→${port[3]} is published on all interfaces — bind to 127.0.0.1 ("127.0.0.1:${port[2]}:${port[3]}") or keep it on the internal network`)
      }
      const secret = /^\s*(AUTH_JWT_SECRET|JWT_SECRET)\s*=\s*(\S+)/.exec(text)
      if (secret && !/^["']?(\$|<|\{\{|change|replace|your)/i.test(secret[2]) && secret[2].replace(/["']/g, '').length >= 8) {
        add('LOW', 'ENV-EXAMPLE-SECRET', file, i + 1, `${secret[1]} has a concrete value in an example file — leave it empty (generate at provisioning) and make sure the app refuses known placeholders`)
      }
      const pass = /^\s*\w*PASSWORD\s*=\s*["']?(admin\w*|password\w*|changeme\w*|12345\w*)["']?\s*$/i.exec(text)
      if (pass) add('MEDIUM', 'ENV-EXAMPLE-PASSWORD', file, i + 1, 'weak default password in an example file')
    })
  }
  const gitignore = join(ROOT, '.gitignore')
  if (existsSync(gitignore) && !/^\/?\.env\b/m.test(readFileSync(gitignore, 'utf8'))) {
    add('MEDIUM', 'GITIGNORE-ENV', { rel: '.gitignore', lines: [] }, null, '.gitignore does not exclude .env files — secrets can be committed')
  }
  const pkgDir = [dirname2(SRC), ROOT].find((d) => existsSync(join(d, 'package.json')))
  if (pkgDir) {
    const locks = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].filter((n) => existsSync(join(pkgDir, n)))
    if (locks.length > 1) add('LOW', 'LOCKFILE-MIXED', { rel: relative(ROOT, pkgDir) || '.', lines: [] }, null, `several lockfiles (${locks.join(', ')}) — keep one package manager`)
    if (locks.length === 0) add('LOW', 'LOCKFILE-MISSING', { rel: relative(ROOT, pkgDir) || '.', lines: [] }, null, 'no lockfile — builds are not reproducible')
  }
  return pkgDir
}
function dirname2(p) { return resolve(p, '..') }
const pkgDir = auditDeploy()

// ───────────────────────────── 6. DEPS ─────────────────────────────
if (DEPS) {
  if (!pkgDir) add('INFO', 'DEPS-SKIPPED', null, null, 'no package.json found next to the source directory')
  else {
    const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: pkgDir, encoding: 'utf8', timeout: 120_000, shell: process.platform === 'win32' })
    try {
      const v = JSON.parse(r.stdout || '{}')?.metadata?.vulnerabilities
      if (!v) throw new Error(r.stderr?.trim().split('\n')[0] || 'no audit data (offline or no lockfile?)')
      const sum = `critical ${v.critical}, high ${v.high}, moderate ${v.moderate}, low ${v.low}`
      if (v.critical + v.high > 0) add('HIGH', 'DEPS-VULNERABLE', null, null, `npm audit (production deps): ${sum}`)
      else if (v.moderate > 0) add('MEDIUM', 'DEPS-VULNERABLE', null, null, `npm audit (production deps): ${sum}`)
      else add('INFO', 'DEPS-OK', null, null, `npm audit (production deps): ${sum}`)
    } catch (error) {
      add('INFO', 'DEPS-SKIPPED', null, null, `npm audit could not run: ${error.message}`)
    }
  }
}

// ───────────────────────────── report ─────────────────────────────
findings.sort((a, b) => SEV[b.sev] - SEV[a.sev] || String(a.file).localeCompare(String(b.file)) || (a.line ?? 0) - (b.line ?? 0))
const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }
for (const f of findings) counts[f.sev]++

if (JSON_OUT) {
  console.log(JSON.stringify({ summary: counts, stats, findings }, null, 2))
} else {
  console.log(`Backend audit: ${stats.files} files, ${stats.graphql} GraphQL resolvers, ${stats.rest} REST routes (src: ${relative(ROOT, SRC) || '.'})\n`)
  let last = ''
  for (const f of findings) {
    if (f.sev !== last) { console.log(`── ${f.sev} ──`); last = f.sev }
    console.log(`  [${f.rule}] ${f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '(project)'}`)
    console.log(`      ${f.msg}`)
  }
  console.log(`\nSummary: ${counts.HIGH} high, ${counts.MEDIUM} medium, ${counts.LOW} low, ${counts.INFO} info`)
  if (!findings.length) console.log('No findings.')
  console.log('Suppress a reviewed finding with:  // audit-ignore: RULE-ID reason')
}

const threshold = { high: 3, medium: 2, low: 1, none: 99 }[FAIL_ON] ?? 3
process.exit(findings.some((f) => SEV[f.sev] >= threshold) ? 1 : 0)
