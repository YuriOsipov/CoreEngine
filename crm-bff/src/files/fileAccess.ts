/**
 * Gate file reads on parent-record entity read (not a global files bypass).
 */
import type { MeUser } from '../adapters/usersAdapter.js'
import { findFile } from '../adapters/filesAdapter.js'
import { listFileParentLinks } from '../adapters/postgresFiles.js'
import { assertMeEntityPermission } from '../services/rolePermissions.js'

function uploadedById(row: Record<string, unknown>): string | null {
  const raw = row.uploaded_by
  if (raw == null || raw === '') return null
  if (typeof raw === 'object') {
    const id = (raw as { id?: unknown }).id
    return id == null ? null : String(id)
  }
  return String(raw)
}

type FileParentRef = { collection: string; recordId: string | null }

async function parentRefsForFile(
  fileId: string,
  row: Record<string, unknown>,
): Promise<FileParentRef[]> {
  const out: FileParentRef[] = []
  const seen = new Set<string>()
  const push = (collection: string, recordId: string | null) => {
    const key = `${collection}\0${recordId ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ collection, recordId })
  }
  const parent = String(row.parent_collection || '').trim()
  if (parent) {
    const recordId = String(row.parent_record_id || '').trim() || null
    push(parent, recordId)
  }
  try {
    const links = await listFileParentLinks(fileId)
    for (const link of links) {
      const collection = String(link.parent_collection || '').trim()
      if (!collection) continue
      const recordId = String(link.parent_record_id || '').trim() || null
      push(collection, recordId)
    }
  } catch {
    // Links table may be unavailable in older DBs — fall back to row parent only.
  }
  return out
}

/**
 * Caller may read the file if they can read any linked parent entity,
 * or (orphan) they are admin / the uploader.
 */
export async function assertFileReadable(
  me: MeUser,
  fileId: string,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const id = String(fileId || '').trim()
  if (!id) throw new Error('File not found')
  const needMeta = ['parent_collection', 'parent_record_id', 'uploaded_by']
  const loadFields = fields?.length
    ? Array.from(new Set([...fields, ...needMeta]))
    : null
  const row = await findFile(id, loadFields)
  if (!row) throw new Error(`File not found: ${id}`)

  if (me.adminAccess || me.roleAdminAccess) return row

  const parents = await parentRefsForFile(id, row)
  if (!parents.length) {
    const uploader = uploadedById(row)
    if (uploader && uploader === String(me.id)) return row
    throw new Error('Permission denied: read on files')
  }

  for (const parent of parents) {
    try {
      await assertMeEntityPermission(me, parent.collection, 'read')
      return row
    } catch {
      // try next parent
    }
  }
  throw new Error('Permission denied: read on files')
}

export async function assertFilesReadable(
  me: MeUser,
  ids: string[],
  fields?: string[] | null,
): Promise<Record<string, unknown>[]> {
  const unique = [...new Set((ids ?? []).map(String).filter(Boolean))]
  const out: Record<string, unknown>[] = []
  for (const id of unique) {
    try {
      out.push(await assertFileReadable(me, id, fields))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/not found/i.test(message)) continue
      throw error
    }
  }
  const byId = new Map(out.map((row) => [String(row.id), row]))
  return unique
    .map((id) => byId.get(id))
    .filter((row): row is Record<string, unknown> => Boolean(row))
}

/**
 * Caller may change / delete the file if they can update any linked parent
 * entity, or (orphan) they are admin / the uploader. Read access is not enough.
 */
export async function assertFileWritable(
  me: MeUser,
  fileId: string,
): Promise<Record<string, unknown>> {
  const id = String(fileId || '').trim()
  if (!id) throw new Error('File not found')
  const row = await findFile(id, ['parent_collection', 'parent_record_id', 'uploaded_by'])
  if (!row) throw new Error(`File not found: ${id}`)

  if (me.adminAccess || me.roleAdminAccess) return row

  const parents = await parentRefsForFile(id, row)
  if (!parents.length) {
    const uploader = uploadedById(row)
    if (uploader && uploader === String(me.id)) return row
    throw new Error('Permission denied: update on files')
  }

  for (const parent of parents) {
    try {
      await assertMeEntityPermission(me, parent.collection, 'update', {
        recordId: parent.recordId,
      })
      return row
    } catch {
      // try next parent
    }
  }
  throw new Error('Permission denied: update on files')
}

/** Upload/link to a parent requires update on that collection (and record for users). */
export async function assertFileParentWritable(
  me: MeUser,
  parentCollection: string | null | undefined,
  parentRecordId?: string | null,
): Promise<void> {
  const collection = String(parentCollection || '').trim()
  if (!collection) return
  await assertMeEntityPermission(me, collection, 'update', {
    recordId: parentRecordId,
  })
}
