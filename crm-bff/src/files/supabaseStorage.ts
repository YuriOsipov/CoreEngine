import { config as loadEnv } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localDiskRead, localDiskWrite } from './localDiskStorage.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../..')

loadEnv({ path: resolve(repoRoot, '.env') })
loadEnv({ path: resolve(repoRoot, 'supabase/.env'), override: true })
loadEnv({ path: resolve(__dirname, '../../.env') })

const DEFAULT_BUCKET = 'crm-files'

export function filesBucket(): string {
  return (process.env.FILES_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET
}

function storageConfig(): { baseUrl: string; serviceKey: string } | null {
  // Server-only names — never VITE_* (Vite inlines those into the browser bundle).
  const baseUrl = (
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_PUBLIC_URL ||
    ''
  ).replace(/\/$/, '')
  const serviceKey =
    process.env.SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
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

function isRetryableStorageFailure(status: number, body: string): boolean {
  if (status === 429 || status === 502 || status === 503 || status === 504 || status === 544) {
    return true
  }
  return /DatabaseTimeout|connection timed out|ECONNRESET|ETIMEDOUT/i.test(body)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function collectErrorText(error: unknown, seen = new Set<unknown>()): string {
  if (!error || typeof error !== 'object' || seen.has(error)) return ''
  seen.add(error)
  const record = error as { message?: unknown; code?: unknown; cause?: unknown; errors?: unknown }
  const parts = [record.message, record.code].filter((part) => typeof part === 'string')
  if (record.cause) parts.push(collectErrorText(record.cause, seen))
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) parts.push(collectErrorText(item, seen))
  }
  return parts.join(' ')
}

/** True when the storage HTTP API cannot be reached (nothing is listening). */
export function isStorageUnreachable(error: unknown): boolean {
  return /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH/i.test(
    collectErrorText(error),
  )
}

let localFallbackWarned = false

function warnLocalFallback(error: unknown): void {
  if (localFallbackWarned) return
  localFallbackWarned = true
  console.warn(
    `[files] Supabase Storage is unreachable (${collectErrorText(error)}). Saving files on local disk.`,
  )
}

async function putRemote(options: {
  path: string
  buffer: Buffer
  mimeType?: string | null
}): Promise<void> {
  await ensureFilesBucket()
  const encoded = options.path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  const maxAttempts = 3
  let lastError = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await storageFetch(`/object/${filesBucket()}/${encoded}`, {
      method: 'POST',
      headers: {
        'Content-Type': options.mimeType || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: new Uint8Array(options.buffer),
    })
    if (res.ok) return
    const text = await res.text()
    lastError = `Storage upload failed (${res.status}): ${text.slice(0, 400)}`
    if (attempt < maxAttempts && isRetryableStorageFailure(res.status, text)) {
      await sleep(400 * attempt)
      continue
    }
    throw new Error(lastError)
  }
  throw new Error(lastError || 'Storage upload failed')
}

export async function storageUpload(options: {
  path: string
  buffer: Buffer
  mimeType?: string | null
}): Promise<{ location: 'supabase' | 'local' }> {
  try {
    await putRemote(options)
    return { location: 'supabase' }
  } catch (error) {
    if (!isStorageUnreachable(error)) throw error
    warnLocalFallback(error)
    await localDiskWrite(options.path, options.buffer)
    return { location: 'local' }
  }
}

async function downloadRemote(path: string): Promise<{
  buffer: Buffer
  contentType: string | null
} | null> {
  // Bucket may be missing after a fresh Supabase volume; create before GET so
  // callers see object-missing (null) instead of opaque NoSuchBucket.
  await ensureFilesBucket()
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
    // Storage sometimes returns 400 + NoSuchKey / NoSuchBucket in the body.
    if (/NoSuchKey|not_found|Object not found|NoSuchBucket|Bucket not found/i.test(text)) {
      return null
    }
    throw new Error(`Storage download failed (${res.status}): ${text.slice(0, 400)}`)
  }
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type'),
  }
}

export async function storageDownload(path: string): Promise<{
  buffer: Buffer
  contentType: string | null
} | null> {
  try {
    return await downloadRemote(path)
  } catch (error) {
    if (!isStorageUnreachable(error)) throw error
    const buffer = await localDiskRead(path)
    if (!buffer) throw error
    return { buffer, contentType: null }
  }
}
