/**
 * Assert M2A nested writes: peel alias off parent JSONB, materialize visit_blocks,
 * expand both item + provider on return.
 *
 * Usage: npm run bff:check-m2a-write
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
  const item = await query<{ record_id: string; name: string }>(
    "SELECT record_id, data->>'name' AS name FROM crm_schema.item WHERE status <> 'archived' ORDER BY record_id LIMIT 1",
  )
  const provider = await query<{ record_id: string; name: string }>(
    "SELECT record_id, data->>'name' AS name FROM crm_schema.provider WHERE status <> 'archived' ORDER BY record_id LIMIT 1",
  )
  if (!item[0] || !provider[0]) {
    console.error('FAIL: need at least one item and one provider record')
    process.exit(1)
  }

  const created = await createRecord(
    'visit',
    {
      note: 'm2a-write-smoke',
      blocks: [
        {
          collection: 'item',
          item: { id: item[0].record_id },
          sort: 0,
          hide_block: true,
        },
        { collection: 'provider', item: provider[0].record_id, sort: 1 },
      ],
    },
    ['id', 'note', 'blocks', 'blocks.item.name', 'blocks.collection', 'blocks.hide_block'],
  )
  const visitId = String(created.id)
  createdIds.push({ entity: 'visit', id: visitId })

  assert(created.note === 'm2a-write-smoke', 'create returned parent note')

  const parentRow = await query<{ data: Record<string, unknown> }>(
    "SELECT data FROM crm_schema.visit WHERE record_id=$1 LIMIT 1",
    [visitId],
  )
  assert(
    parentRow[0] != null && !('blocks' in (parentRow[0].data ?? {})),
    'parent JSONB has no blocks key',
  )

  const junctionRows = await query<{ record_id: string; data: Record<string, unknown> }>(
    "SELECT record_id, data FROM crm_schema.visit_blocks WHERE status <> 'archived' AND (data->>'visit_id') = $1 ORDER BY (data->>'sort')::int NULLS LAST, record_id",
    [visitId],
  )
  assert(junctionRows.length === 2, `visit_blocks count === 2 (got ${junctionRows.length})`)
  for (const row of junctionRows) {
    createdIds.push({ entity: 'visit_blocks', id: row.record_id })
  }

  const blocks = Array.isArray(created.blocks) ? created.blocks : []
  assert(blocks.length === 2, `expanded blocks count === 2 (got ${blocks.length})`)

  const itemBlock = blocks.find(
    (row) => String((row as Record<string, unknown>).collection) === 'item',
  ) as Record<string, unknown> | undefined
  const providerBlock = blocks.find(
    (row) => String((row as Record<string, unknown>).collection) === 'provider',
  ) as Record<string, unknown> | undefined

  assert(
    itemBlock != null &&
      typeof itemBlock.item === 'object' &&
      String((itemBlock.item as { name?: unknown }).name || '') === item[0].name,
    `item block hydrated name === ${item[0].name}`,
  )
  assert(
    itemBlock != null && itemBlock.hide_block === true,
    'item block hide_block === true on create expand',
  )
  const itemJunctionDb = junctionRows.find(
    (row) => String(row.data.collection) === 'item',
  )
  assert(
    itemJunctionDb != null && itemJunctionDb.data.hide_block === true,
    'item junction JSONB hide_block === true',
  )
  assert(
    providerBlock != null &&
      typeof providerBlock.item === 'object' &&
      String((providerBlock.item as { name?: unknown }).name || '') === provider[0].name,
    `provider block hydrated name === ${provider[0].name}`,
  )

  const providerJunctionId = String(providerBlock?.id ?? '')
  assert(Boolean(providerJunctionId), 'provider junction id present')

  const updated = await updateRecord(
    'visit',
    visitId,
    {
      blocks: [
        {
          id: providerJunctionId,
          collection: 'provider',
          item: { id: provider[0].record_id },
          sort: 0,
          hide_block: true,
        },
        {
          id: String(itemBlock?.id),
          collection: 'item',
          item: item[0].record_id,
          delete: true,
        },
      ],
    },
    ['id', 'blocks', 'blocks.collection', 'blocks.item.name', 'blocks.hide_block'],
  )

  const updatedBlocks = Array.isArray(updated.blocks) ? updated.blocks : []
  assert(updatedBlocks.length === 1, `after update blocks count === 1 (got ${updatedBlocks.length})`)
  assert(
    updatedBlocks.every(
      (row) => String((row as Record<string, unknown>).collection) === 'provider',
    ),
    'remaining block is provider',
  )
  assert(
    updatedBlocks[0] != null &&
      (updatedBlocks[0] as Record<string, unknown>).hide_block === true,
    'provider block hide_block === true after update',
  )

  const afterDelete = await query<{ count: string }>(
    "SELECT count(*)::text AS count FROM crm_schema.visit_blocks WHERE (data->>'visit_id') = $1",
    [visitId],
  )
  assert(afterDelete[0]?.count === '1', `junction rows after delete === 1 (got ${afterDelete[0]?.count})`)

  // Re-read via findOne to confirm expand still works
  const reread = await findOneRecord('visit', visitId, [
    'id',
    'blocks.item.name',
    'blocks.hide_block',
  ])
  const rereadBlocks = Array.isArray(reread.blocks) ? reread.blocks : []
  assert(rereadBlocks.length === 1, 'reread blocks count === 1')
  assert(
    (rereadBlocks[0] as Record<string, unknown>).hide_block === true,
    'reread hide_block === true',
  )
} finally {
  // Cleanup junction rows first, then visit
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

console.log('\nok: M2A nested write path')
