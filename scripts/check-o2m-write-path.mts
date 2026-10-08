/**
 * Assert O2M nested writes: peel attachments off parent JSONB, materialize visit_files.
 *
 * Usage: npm run bff:check-o2m-write
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { clearRecordRelationsCache } from '../crm-bff/src/adapters/recordRelations.ts'
import { clearRecordsBackendCache } from '../crm-bff/src/adapters/recordsAdapter.ts'
import {
  createRecord,
  findOneRecord,
  hardDeleteRecord,
  updateRecord,
} from '../crm-bff/src/adapters/recordsAdapter.ts'

clearRecordsBackendCache()
clearRecordRelationsCache()

let failed = 0
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log('ok:', message)
    return
  }
  failed += 1
  console.error('FAIL:', message)
}

const createdIds: { entity: string; id: string }[] = []

try {
  const files = await query<{ id: string; filename: string | null }>(
    "SELECT id::text AS id, filename FROM public.files WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 2",
  )
  if (files.length < 1) {
    console.error('FAIL: need at least one public.files row')
    process.exit(1)
  }

  const fileA = files[0]!
  const fileB = files[1] ?? files[0]!

  const created = await createRecord(
    'visit',
    {
      note: 'o2m-write-smoke',
      attachments: [
        { file_id: { id: fileA.id } },
        { file_id: fileB.id },
      ],
    },
    ['id', 'note', 'attachments', 'attachments.file_id.id', 'attachments.file_id.filename_download'],
  )
  const visitId = String(created.id)
  createdIds.push({ entity: 'visit', id: visitId })

  assert(created.note === 'o2m-write-smoke', 'create returned parent note')

  const parentRow = await query<{ data: Record<string, unknown> }>(
    "SELECT data FROM crm_schema.visit WHERE record_id=$1 LIMIT 1",
    [visitId],
  )
  assert(
    parentRow[0] != null && !('attachments' in (parentRow[0].data ?? {})),
    'parent JSONB has no attachments key',
  )

  const junctionRows = await query<{ record_id: string; data: Record<string, unknown> }>(
    "SELECT record_id, data FROM crm_schema.visit_files WHERE status <> 'archived' AND (data->>'visit_id') = $1",
    [visitId],
  )
  assert(
    junctionRows.length === 2,
    `visit_files count === 2 (got ${junctionRows.length})`,
  )
  for (const row of junctionRows) {
    createdIds.push({ entity: 'visit_files', id: row.record_id })
  }

  const attachments = Array.isArray(created.attachments) ? created.attachments : []
  assert(
    attachments.length === 2,
    `expanded attachments count === 2 (got ${attachments.length})`,
  )
  assert(
    attachments.every((row) => {
      const file = (row as Record<string, unknown>).file_id
      return file && typeof file === 'object' && 'id' in (file as object)
    }),
    'attachments.file_id hydrated',
  )

  const keepId = String((attachments[0] as Record<string, unknown>).id ?? '')
  const dropId = String((attachments[1] as Record<string, unknown>).id ?? '')
  assert(Boolean(keepId) && Boolean(dropId), 'junction ids present')

  const updated = await updateRecord(
    'visit',
    visitId,
    {
      attachments: [
        { id: keepId, file_id: fileA.id },
        { id: dropId, file_id: fileB.id, delete: true },
      ],
    },
    ['id', 'attachments', 'attachments.file_id.id'],
  )
  const updatedAttachments = Array.isArray(updated.attachments) ? updated.attachments : []
  assert(
    updatedAttachments.length === 1,
    `after update attachments count === 1 (got ${updatedAttachments.length})`,
  )

  const afterDelete = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM crm_schema.visit_files WHERE (data->>'visit_id') = $1",
    [visitId],
  )
  assert(
    afterDelete[0]?.count === '1',
    `junction rows after delete === 1 (got ${afterDelete[0]?.count})`,
  )

  const reread = await findOneRecord('visit', visitId, [
    'id',
    'attachments.file_id.filename_download',
  ])
  const rereadAttachments = Array.isArray(reread.attachments) ? reread.attachments : []
  assert(rereadAttachments.length === 1, 'reread attachments count === 1')
} finally {
  for (const entry of [...createdIds].reverse()) {
    try {
      await hardDeleteRecord(entry.entity, entry.id)
    } catch (err) {
      console.warn('cleanup warning:', entry.entity, entry.id, err)
    }
  }
  await pool.end()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}

console.log('\nok: O2M nested write path')
