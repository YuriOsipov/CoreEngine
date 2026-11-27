/** True when the external flow was called with Wait for response (/sync). */
export function flowResponseWasSync(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const sync = (body as Record<string, unknown>).sync
  return sync === true || String(sync ?? '').trim().toLowerCase() === 'true'
}

export type FlowResponseContract = {
  success: boolean
  message: string
  file: File | null
}

const DATA_URL = /^data:([^,]*),([\s\S]*)$/i

const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readSuccess(record: Record<string, unknown>): boolean | null {
  if (typeof record.Success === 'boolean') return record.Success
  if (typeof record.success === 'boolean') return record.success
  return null
}

function readMessage(record: Record<string, unknown>): string {
  const value = record.Message ?? record.message
  return typeof value === 'string' ? value.trim() : ''
}

function readFileName(record: Record<string, unknown>): string {
  const value = record.FileName ?? record.fileName ?? record.filename
  if (typeof value !== 'string') return ''
  const cleaned = value
    .trim()
    .replace(/[/\\]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
  return cleaned
}

function mimeFromFileName(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_MIME[extension] || 'application/octet-stream'
}

function decodeBase64(payload: string): Uint8Array | null {
  const cleaned = payload.replace(/\s+/g, '')
  if (!cleaned || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(cleaned)) return null
  const normalized = cleaned.replace(/-/g, '+').replace(/_/g, '/')
  const pad =
    normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  try {
    const binary = atob(normalized + pad)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

function decodeData(raw: string): { bytes: Uint8Array; mime: string | null } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(DATA_URL)
  if (!match) {
    const bytes = decodeBase64(trimmed)
    return bytes ? { bytes, mime: null } : null
  }
  const meta = match[1] ?? ''
  const payload = match[2] ?? ''
  const mimePart = meta.split(';')[0]?.trim() || null
  if (!/base64/i.test(meta)) {
    try {
      const text = decodeURIComponent(payload)
      return { bytes: new TextEncoder().encode(text), mime: mimePart || 'text/plain' }
    } catch {
      return null
    }
  }
  const bytes = decodeBase64(payload)
  return bytes ? { bytes, mime: mimePart } : null
}

function decodeFile(record: Record<string, unknown>): File | null {
  const raw = record.Data ?? record.data
  if (typeof raw !== 'string' || !raw.trim()) return null
  const decoded = decodeData(raw)
  if (!decoded) return null
  const name = readFileName(record) || 'response.bin'
  const mime = decoded.mime || mimeFromFileName(name)
  return new File([decoded.bytes], name, { type: mime })
}

/**
 * Sync external-flow body. `null` when the payload is not the contract
 * (for example an immediate webhook ack).
 */
export function parseFlowResponseContract(body: unknown): FlowResponseContract | null {
  const root = asRecord(body)
  if (!root) return null
  const nested = asRecord(root.result)
  const source =
    nested && readSuccess(nested) !== null
      ? nested
      : readSuccess(root) !== null
        ? root
        : null
  if (!source) return null
  const success = readSuccess(source)
  if (success === null) return null
  return {
    success,
    message: readMessage(source),
    file: decodeFile(source),
  }
}
