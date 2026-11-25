/**
 * Import CoreEngine Activepieces templates (MIT) without Platform API keys.
 *
 * Uses admin email/password → JWT (CE sign-in), then create / IMPORT_FLOW /
 * LOCK_AND_PUBLISH. Writes resulting flow ids into Setup → Connections.
 *
 * Usage (repo root, after first admin exists in Activepieces UI or --sign-up):
 *   npm run registry:seed-activepieces-flows
 *   npm run registry:seed-activepieces-flows -- --dry-run
 *   npm run registry:seed-activepieces-flows -- --sign-up
 *   npm run registry:seed-activepieces-flows -- --only=sync_promo_prices
 *
 * Env:
 *   AP_EMAIL / AP_PASSWORD (or ACTIVEPIECES_EMAIL / ACTIVEPIECES_PASSWORD)
 *   ACTIVEPIECES_SEED_URL or AP_FRONTEND_URL (host reachability; default 127.0.0.1:8081)
 *   ACTIVEPIECES_WEBHOOK_SECRET (or N8N_WEBHOOK_SECRET) → project var ACTIVEPIECES_WEBHOOK_SECRET
 *   CRM_N8N_EMAIL / CRM_N8N_PASSWORD → project vars (BFF login; not inlined in flows)
 *   BFF_URL → project var BFF_URL (default http://host.docker.internal:4000)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query } from '../crm-bff/src/db/pool.ts'
import {
  activepiecesWebhookSecret,
} from '../crm-bff/src/flows/flowAuth.ts'

const dryRun = process.argv.includes('--dry-run')
const wantSignUp = process.argv.includes('--sign-up')
const leaveDisabled = process.argv.includes('--leave-disabled')

function argValue(prefix: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`))
  return hit ? hit.slice(prefix.length + 1).trim() || null : null
}

const onlyKey = argValue('--only')

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(__dirname, '../docs/activepieces')

type ApFlowTemplate = {
  displayName: string
  schemaVersion: string | null
  notes: unknown[]
  trigger: Record<string, unknown>
}

type ApTemplateFile = {
  name?: string
  description?: string
  flows: ApFlowTemplate[]
}

type SeedFlow = {
  connectionKey: string
  file: string
  sync: boolean
  description: string
}

/** Maps repo templates → Setup → Connections keys. */
const SEED_FLOWS: SeedFlow[] = [
  {
    connectionKey: 'sync_promo_prices',
    file: 'sync-promo-prices.flow.json',
    sync: true,
    description:
      'Sync promo prices (Activepieces). Seeded by registry:seed-activepieces-flows.',
  },
  {
    connectionKey: 'dispatch_outbound_message',
    file: 'dispatch-outbound-message.flow.json',
    sync: false,
    description:
      'Sales Message outbox via Activepieces Catch Webhook. Seeded by registry:seed-activepieces-flows.',
  },
]

type AuthResponse = {
  token?: string
  projectId?: string
  email?: string
  id?: string
}

type FlowRow = {
  id: string
  externalId?: string
  version?: { displayName?: string }
  metadata?: Record<string, unknown> | null
}

function seedBaseUrl(): string {
  const explicit = (
    process.env.ACTIVEPIECES_SEED_URL ||
    process.env.AP_FRONTEND_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '')
  if (explicit) return explicit

  const base = (process.env.ACTIVEPIECES_BASE_URL || '').trim().replace(/\/+$/, '')
  // Docker DNS from host is useless for this script.
  if (base && !/\/\/activepieces(?::\d+)?(\/|$)/i.test(base)) return base

  const port = (process.env.ACTIVEPIECES_PUBLISH_PORT || '8081').trim()
  return `http://127.0.0.1:${port}`
}

function adminEmail(): string {
  return (
    process.env.AP_EMAIL ||
    process.env.ACTIVEPIECES_EMAIL ||
    ''
  )
    .trim()
    .toLowerCase()
}

function adminPassword(): string {
  return (
    process.env.AP_PASSWORD ||
    process.env.ACTIVEPIECES_PASSWORD ||
    ''
  ).trim()
}

function externalIdFor(connectionKey: string): string {
  return `ce-${connectionKey}`
}

/** Map legacy template placeholders → project variable references (no secrets inlined). */
function substitutePlaceholders(raw: string): string {
  return raw
    .split('{{YOUR_ACTIVEPIECES_WEBHOOK_SECRET}}')
    .join("{{variables['ACTIVEPIECES_WEBHOOK_SECRET']}}")
    .split('{{YOUR_CRM_N8N_EMAIL}}')
    .join("{{variables['CRM_N8N_EMAIL']}}")
    .split('{{YOUR_CRM_N8N_PASSWORD}}')
    .join("{{variables['CRM_N8N_PASSWORD']}}")
    .split('http://host.docker.internal:4000')
    .join("{{variables['BFF_URL']}}")
}

function bffUrlForVariable(): string {
  return (
    (process.env.BFF_URL || '').trim().replace(/\/+$/, '') ||
    'http://host.docker.internal:4000'
  )
}

type VarRow = { id: string; name: string }

async function upsertProjectVariables(
  base: string,
  token: string,
  projectId: string,
): Promise<void> {
  const desired: Array<{ name: string; value: string }> = []
  const secret = activepiecesWebhookSecret()
  const email = (process.env.CRM_N8N_EMAIL || '').trim()
  const password = (process.env.CRM_N8N_PASSWORD || '').trim()
  desired.push({ name: 'BFF_URL', value: bffUrlForVariable() })
  if (secret) desired.push({ name: 'ACTIVEPIECES_WEBHOOK_SECRET', value: secret })
  if (email) desired.push({ name: 'CRM_N8N_EMAIL', value: email })
  if (password) desired.push({ name: 'CRM_N8N_PASSWORD', value: password })

  const missing = ['CRM_N8N_EMAIL', 'CRM_N8N_PASSWORD', 'ACTIVEPIECES_WEBHOOK_SECRET'].filter(
    (name) => !desired.some((d) => d.name === name),
  )
  if (missing.length) {
    console.warn(
      `warn project vars skipped (set in .env): ${missing.join(', ')} — flows reference {{variables['…']}}`,
    )
  }

  for (const item of desired) {
    if (dryRun) {
      console.log(`dry-run variable ${item.name}`)
      continue
    }
    const listed = await apFetch<{ data?: VarRow[] }>(
      base,
      `/api/v1/variables?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(item.name)}&limit=50`,
      { token },
    )
    const existing = listed.body.data?.find((v) => v.name === item.name)
    if (existing) {
      const updated = await apFetch<unknown>(base, `/api/v1/variables/${existing.id}`, {
        method: 'POST',
        token,
        body: JSON.stringify({ value: item.value }),
      })
      if (updated.status < 200 || updated.status >= 300) {
        throw new Error(
          `Update variable ${item.name} failed (HTTP ${updated.status}): ${JSON.stringify(updated.body).slice(0, 200)}`,
        )
      }
      console.log(`updated variable ${item.name}`)
    } else {
      const created = await apFetch<VarRow>(base, '/api/v1/variables', {
        method: 'POST',
        token,
        body: JSON.stringify({
          projectId,
          name: item.name,
          value: item.value,
        }),
      })
      if (created.status !== 201 && created.status !== 200) {
        throw new Error(
          `Create variable ${item.name} failed (HTTP ${created.status}): ${JSON.stringify(created.body).slice(0, 200)}`,
        )
      }
      console.log(`created variable ${item.name}`)
    }
  }
}

async function apFetch<T>(
  base: string,
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: T }> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (init.token) {
    headers.set('Authorization', `Bearer ${init.token}`)
  }
  const res = await fetch(`${base}${path}`, { ...init, headers })
  const text = await res.text()
  let body: T
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    throw new Error(`Activepieces ${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  return { status: res.status, body }
}

async function authenticate(base: string): Promise<AuthResponse> {
  const email = adminEmail()
  const password = adminPassword()
  if (!email || !password) {
    throw new Error(
      'Set AP_EMAIL and AP_PASSWORD (or ACTIVEPIECES_EMAIL / ACTIVEPIECES_PASSWORD) for Activepieces admin.',
    )
  }

  if (wantSignUp) {
    const signed = await apFetch<AuthResponse>(base, '/api/v1/authentication/sign-up', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        firstName: 'CoreEngine',
        lastName: 'Admin',
        trackEvents: false,
        newsLetter: false,
      }),
    })
    if (signed.status >= 200 && signed.status < 300 && signed.body.token) {
      console.log(`signed up Activepieces admin ${email}`)
      return signed.body
    }
    // Already exists → fall through to sign-in
    console.warn(
      `sign-up HTTP ${signed.status} — trying sign-in (${JSON.stringify(signed.body).slice(0, 160)})`,
    )
  }

  const signedIn = await apFetch<AuthResponse>(base, '/api/v1/authentication/sign-in', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (signedIn.status < 200 || signedIn.status >= 300 || !signedIn.body.token) {
    throw new Error(
      `Activepieces sign-in failed (HTTP ${signedIn.status}). Create the first admin in the UI or pass --sign-up. Body: ${JSON.stringify(signedIn.body).slice(0, 240)}`,
    )
  }
  return signedIn.body
}

async function findExistingFlow(
  base: string,
  token: string,
  projectId: string,
  connectionKey: string,
  displayName: string,
): Promise<FlowRow | null> {
  const ext = encodeURIComponent(externalIdFor(connectionKey))
  const byExt = await apFetch<{ data?: FlowRow[] }>(
    base,
    `/api/v1/flows?projectId=${encodeURIComponent(projectId)}&externalIds=${ext}&limit=50`,
    { token },
  )
  const fromExt = byExt.body.data?.find(
    (f) => f.externalId === externalIdFor(connectionKey),
  )
  if (fromExt) return fromExt

  const byName = await apFetch<{ data?: FlowRow[] }>(
    base,
    `/api/v1/flows?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(displayName)}&limit=50`,
    { token },
  )
  const hit = byName.body.data?.find(
    (f) =>
      f.version?.displayName === displayName ||
      f.metadata?.coreengineConnectionKey === connectionKey,
  )
  return hit || null
}

async function ensureFlow(
  base: string,
  token: string,
  projectId: string,
  seed: SeedFlow,
  flowDef: ApFlowTemplate,
): Promise<string> {
  const displayName = flowDef.displayName
  const existing = await findExistingFlow(
    base,
    token,
    projectId,
    seed.connectionKey,
    displayName,
  )

  let flowId = existing?.id
  if (!flowId) {
    if (dryRun) {
      console.log(`dry-run create flow ${displayName} (externalId=${externalIdFor(seed.connectionKey)})`)
      return '(dry-run)'
    }
    const created = await apFetch<FlowRow>(base, '/api/v1/flows', {
      method: 'POST',
      token,
      body: JSON.stringify({
        displayName,
        projectId,
        externalId: externalIdFor(seed.connectionKey),
        metadata: { coreengineConnectionKey: seed.connectionKey },
      }),
    })
    if (created.status !== 201 || !created.body.id) {
      throw new Error(
        `Create flow failed (HTTP ${created.status}): ${JSON.stringify(created.body).slice(0, 300)}`,
      )
    }
    flowId = created.body.id
    console.log(`created flow ${displayName} → ${flowId}`)
  } else if (dryRun) {
    console.log(`dry-run update flow ${displayName} → ${flowId}`)
    return flowId
  } else {
    console.log(`reuse flow ${displayName} → ${flowId}`)
  }

  const imported = await apFetch<unknown>(base, `/api/v1/flows/${flowId}`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      type: 'IMPORT_FLOW',
      request: {
        displayName: flowDef.displayName,
        trigger: flowDef.trigger,
        schemaVersion: flowDef.schemaVersion ?? null,
        notes: flowDef.notes ?? [],
      },
    }),
  })
  if (imported.status < 200 || imported.status >= 300) {
    throw new Error(
      `IMPORT_FLOW failed for ${flowId} (HTTP ${imported.status}): ${JSON.stringify(imported.body).slice(0, 300)}`,
    )
  }

  const published = await apFetch<unknown>(base, `/api/v1/flows/${flowId}`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      type: 'LOCK_AND_PUBLISH',
      request: { status: 'ENABLED' },
    }),
  })
  if (published.status < 200 || published.status >= 300) {
    throw new Error(
      `LOCK_AND_PUBLISH failed for ${flowId} (HTTP ${published.status}): ${JSON.stringify(published.body).slice(0, 300)}`,
    )
  }
  console.log(`published ${displayName}`)
  return flowId
}

async function upsertConnection(
  seed: SeedFlow,
  flowId: string,
): Promise<void> {
  const enabled = !leaveDisabled
  const config = {
    target: 'activepieces',
    flowId,
    sync: seed.sync,
    method: 'POST',
    headers: { Accept: 'application/json' },
    auth: { type: 'none' },
  }
  if (dryRun) {
    console.log(
      `dry-run connection ${seed.connectionKey} → flowId=${flowId} sync=${seed.sync} enabled=${enabled}`,
    )
    return
  }
  await query(
    `INSERT INTO public.app_flow_triggers (key, handler, enabled, description, config)
     VALUES ($1, 'http', $2, $3, $4::jsonb)
     ON CONFLICT (key) DO UPDATE SET
       handler = EXCLUDED.handler,
       enabled = EXCLUDED.enabled,
       description = EXCLUDED.description,
       config = EXCLUDED.config,
       updated_at = now()`,
    [seed.connectionKey, enabled, seed.description, JSON.stringify(config)],
  )
  console.log(
    `upsert connection ${seed.connectionKey} → flowId=${flowId} enabled=${enabled}`,
  )
}

/**
 * HTTP piece DynamicProperties expect JSON under body.data (not a flat object).
 * Older templates / migrations that omit `data` show `{}` in the UI.
 */
function normalizeHttpJsonBodies(node: unknown): void {
  if (!node || typeof node !== 'object') return
  const step = node as Record<string, unknown>
  const settings = step.settings as Record<string, unknown> | undefined
  const input = settings?.input as Record<string, unknown> | undefined
  if (
    settings?.pieceName === '@activepieces/piece-http' &&
    input &&
    input.body_type === 'json' &&
    input.body &&
    typeof input.body === 'object' &&
    !Array.isArray(input.body) &&
    !('data' in (input.body as object))
  ) {
    input.body = { data: input.body }
  }
  if (!input?.queryParams) {
    if (settings?.pieceName === '@activepieces/piece-http' && input) {
      input.queryParams = {}
    }
  }
  if (
    settings?.pieceName === '@activepieces/piece-http' &&
    input &&
    input.authType == null
  ) {
    input.authType = 'NONE'
  }
  if (step.nextAction) normalizeHttpJsonBodies(step.nextAction)
  if (step.firstLoopAction) normalizeHttpJsonBodies(step.firstLoopAction)
  if (Array.isArray(step.children)) {
    for (const child of step.children) normalizeHttpJsonBodies(child)
  }
  const branches = (settings as { branches?: unknown[] } | undefined)?.branches
  if (Array.isArray(branches)) {
    for (const branch of branches) {
      if (branch && typeof branch === 'object') {
        normalizeHttpJsonBodies((branch as { nextAction?: unknown }).nextAction)
      }
    }
  }
}

function loadTemplate(file: string): ApFlowTemplate {
  const path = join(TEMPLATES_DIR, file)
  const parsed = JSON.parse(substitutePlaceholders(readFileSync(path, 'utf8'))) as ApTemplateFile
  const flow = parsed.flows?.[0]
  if (!flow?.displayName || !flow.trigger) {
    throw new Error(`${file}: expected Activepieces template shape { flows: [{ displayName, trigger }] }`)
  }
  normalizeHttpJsonBodies(flow.trigger)
  return flow
}

function warnUnresolvedPlaceholders(seed: SeedFlow, flow: ApFlowTemplate): void {
  const blob = JSON.stringify(flow)
  if (
    blob.includes('{{YOUR_') ||
    blob.includes('http://host.docker.internal:4000')
  ) {
    console.warn(
      `warn ${seed.connectionKey}: legacy placeholders remain after rewrite — check template`,
    )
  }
}

const selected = SEED_FLOWS.filter(
  (f) => !onlyKey || f.connectionKey === onlyKey,
)
if (onlyKey && selected.length === 0) {
  console.error(`Unknown --only=${onlyKey}. Known: ${SEED_FLOWS.map((f) => f.connectionKey).join(', ')}`)
  await pool.end()
  process.exit(1)
}

const knownFiles = new Set(readdirSync(TEMPLATES_DIR))
for (const seed of selected) {
  if (!knownFiles.has(seed.file)) {
    console.error(`Missing template ${seed.file} under docs/activepieces/`)
    await pool.end()
    process.exit(1)
  }
}

const base = seedBaseUrl()
console.log(`Activepieces seed URL: ${base}`)

try {
  if (dryRun && (!adminEmail() || !adminPassword())) {
    for (const seed of selected) {
      const flowDef = loadTemplate(seed.file)
      warnUnresolvedPlaceholders(seed, flowDef)
      console.log(
        `dry-run ${seed.file} → connection ${seed.connectionKey} (displayName=${flowDef.displayName}, sync=${seed.sync})`,
      )
      await upsertConnection(seed, '(dry-run)')
    }
  } else {
    const auth = await authenticate(base)
    const token = auth.token!
    const projectId = auth.projectId
    if (!projectId) {
      throw new Error('Activepieces auth response missing projectId')
    }
    console.log(`projectId: ${projectId}`)
    await upsertProjectVariables(base, token, projectId)

    for (const seed of selected) {
      const flowDef = loadTemplate(seed.file)
      warnUnresolvedPlaceholders(seed, flowDef)
      const flowId = await ensureFlow(base, token, projectId, seed, flowDef)
      await upsertConnection(seed, flowId)
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        base,
        seeded: selected.map((s) => s.connectionKey),
        note: 'Platform API keys are not required — CE user JWT is used. Re-run is idempotent via externalId ce-{connectionKey}.',
      },
      null,
      2,
    ),
  )
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  await pool.end()
  process.exit(1)
}

await pool.end()
