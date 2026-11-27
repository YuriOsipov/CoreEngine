import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function localRoot(): string {
  const configured = process.env.FILES_LOCAL_DIR?.trim()
  if (configured) return resolve(configured)
  return resolve(repoRoot, 'crm-bff/.file-storage')
}

function localFilePath(storagePath: string): string {
  const parts = storagePath.split('/').filter(Boolean)
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Invalid storage path')
  }
  const root = localRoot()
  const full = resolve(root, ...parts)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error('Invalid storage path')
  }
  return full
}

export async function localDiskWrite(storagePath: string, buffer: Buffer): Promise<void> {
  const full = localFilePath(storagePath)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, buffer)
}

export async function localDiskRead(storagePath: string): Promise<Buffer | null> {
  try {
    return await readFile(localFilePath(storagePath))
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code)
        : ''
    if (code === 'ENOENT') return null
    throw error
  }
}
