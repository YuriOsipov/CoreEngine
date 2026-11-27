import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localDiskRead } from './localDiskStorage.js'
import { isStorageUnreachable, storageUpload } from './supabaseStorage.js'

describe('local file storage', () => {
  let dir = ''
  const previousUrl = process.env.SUPABASE_URL
  const previousKey = process.env.SERVICE_ROLE_KEY

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (dir) await rm(dir, { recursive: true, force: true })
    delete process.env.FILES_LOCAL_DIR
    if (previousUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = previousUrl
    if (previousKey === undefined) delete process.env.SERVICE_ROLE_KEY
    else process.env.SERVICE_ROLE_KEY = previousKey
    dir = ''
  })

  it('treats a refused storage connection as unreachable', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8000'), {
        code: 'ECONNREFUSED',
      }),
    })
    expect(isStorageUnreachable(error)).toBe(true)
    expect(isStorageUnreachable(new Error('Storage upload failed (401): denied'))).toBe(false)
  })

  it('writes the file locally when Supabase Storage refuses the connection', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ce-files-'))
    process.env.FILES_LOCAL_DIR = dir
    process.env.SUPABASE_URL = 'http://127.0.0.1:9'
    process.env.SERVICE_ROLE_KEY = 'test-key'
    vi.stubGlobal('fetch', () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      })
    })

    const stored = await storageUpload({
      path: 'abc/note.txt',
      buffer: Buffer.from('hi'),
      mimeType: 'text/plain',
    })

    expect(stored.location).toBe('local')
    expect((await localDiskRead('abc/note.txt'))?.toString()).toBe('hi')
  })
})
