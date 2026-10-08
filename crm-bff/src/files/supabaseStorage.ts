import { config as loadEnv } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../..')

loadEnv({ path: resolve(repoRoot, '.env') })
loadEnv({ path: resolve(repoRoot, 'supabase/.env') })
loadEnv({ path: resolve(__dirname, '../.env') })

const DEFAULT_BUCKET = 'crm-files'

export function filesBucket(): string {
  return (process.env.FILES_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET
}

function storageConfig(): { baseUrl: string; serviceKey: string } | null {
  const baseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_PUBLIC_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).replace(/\/$/, '')
  const serviceKey =
    process.env.SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    ''
  if (!baseUrl || !serviceKey) return null
  return { baseUrl, serviceKey }
}

export function isSupabaseStorageConfigured(): boolean {
  return storageConfig() != null
}

async function storageFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const cfg = storageConfig()
  if (!cfg) throw new Error('Supabase Storage is not configured')
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${cfg.serviceKey}`)
  headers.set('apikey', cfg.serviceKey)
  return fetch(`${cfg.baseUrl}/storage/v1${path}`, { ...init, headers })
}

let bucketReady: Promise<void> | null = null

/** Create the CRM files bucket once (idempotent). */
export async function ensureFilesBucket(): Promise<void> {
  if (bucketReady) return bucketReady
  bucketReady = (async () => {
    const bucket = filesBucket()
    const listed = await storageFetch('/bucket', { method: 'GET' })
    if (listed.ok) {
      const rows = (await listed.json().catch(() => [])) as Array<{ id?: string; name?: string }>
      if (Array.isArray(rows) && rows.some((row) => row.id === bucket || row.name === bucket)) {
        return
      }
    }
    const created = await storageFetch('/bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: bucket,
        name: bucket,
        public: false,
        file_size_limit: 52_428_800,
      }),
    })
    if (!created.ok && created.status !== 409) {
      const text = await created.text()
      throw new Error(`Create storage bucket failed (${created.status}): ${text.slice(0, 400)}`)
    }
  })()
  try {
    await bucketReady
  } catch (error) {
    bucketReady = null
    throw error
  }
}

export async function storageUpload(options: {
  path: string
  buffer: Buffer
  mimeType?: string | null
}): Promise<void> {
  await ensureFilesBucket()
  const encoded = options.path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const res = await storageFetch(`/object/${filesBucket()}/${encoded}`, {
    method: 'POST',
    headers: {
      'Content-Type': options.mimeType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: new Uint8Array(options.buffer),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Storage upload failed (${res.status}): ${text.slice(0, 400)}`)
  }
}

export async function storageDownload(path: string): Promise<{
  buffer: Buffer
  contentType: string | null
} | null> {
  const encoded = path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const res = await storageFetch(`/object/${filesBucket()}/${encoded}`, {
    method: 'GET',
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Storage download failed (${res.status}): ${text.slice(0, 400)}`)
  }
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type'),
  }
}
