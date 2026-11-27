const BINARY_TYPES = new Set([
  'application/pdf',
  'application/octet-stream',
  'application/zip',
])

export function isBinaryFlowContentType(contentType: string | null | undefined): boolean {
  const mime = String(contentType || '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (!mime) return false
  if (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')) {
    return true
  }
  return BINARY_TYPES.has(mime)
}

function cleanFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/[\u0000-\u001f]/g, '')
  return cleaned
}

export function fileNameFromContentDisposition(
  header: string | null | undefined,
): string {
  if (!header) return ''
  const encoded = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i)
  if (encoded?.[1]) {
    try {
      return cleanFileName(decodeURIComponent(encoded[1].trim()))
    } catch {
      return cleanFileName(encoded[1])
    }
  }
  const plain = header.match(/filename="?([^";]+)"?/i)
  return plain?.[1] ? cleanFileName(plain[1]) : ''
}

export function fileNameFromUrl(url: string): string {
  try {
    const base = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
    return cleanFileName(decodeURIComponent(base))
  } catch {
    return ''
  }
}

/** Sync contract body for an upstream file response. */
export function binaryFlowContract(input: {
  bytes: Buffer
  contentType: string | null | undefined
  contentDisposition: string | null | undefined
  url: string
}): { Success: true; FileName: string; Data: string } {
  const fileName =
    fileNameFromContentDisposition(input.contentDisposition)
    || fileNameFromUrl(input.url)
    || 'response.bin'
  return {
    Success: true,
    FileName: fileName,
    Data: input.bytes.toString('base64'),
  }
}
