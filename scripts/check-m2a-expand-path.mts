/**
 * Assert M2A alias expand: bare `blocks` fully hydrates polymorphic item,
 * and nested `blocks.item.*` still projects selected fields.
 *
 * Usage: npm run bff:check-m2a-expand
 */
import { pool } from '../crm-bff/src/db/pool.ts'
import {
  clearRecordRelationsCache,
  loadM2ARelations,
} from '../crm-bff/src/adapters/recordRelations.ts'
import { findOneRecord } from '../crm-bff/src/adapters/recordsAdapter.ts'

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

const m2a = await loadM2ARelations('visit')
const blocksRel = m2a.find((row) => row.fieldApiName === 'blocks')
assert(
  Boolean(blocksRel && blocksRel.junctionEntityApiName === 'visit_blocks'),
  'visit.blocks → visit_blocks M2A meta',
)

const bare = await findOneRecord('visit', '2', ['id', 'blocks'])
const bareRows = Array.isArray(bare.blocks) ? bare.blocks : []
assert(bareRows.length > 0, `visit/2 bare blocks expanded (count=${bareRows.length})`)
assert(
  bareRows.every((row) => {
    const item = (row as Record<string, unknown>).item
    return (
      item &&
      typeof item === 'object' &&
      Object.keys(item as object).length > 1 &&
      'name' in (item as object)
    )
  }),
  'visit/2 bare blocks.item fully hydrated (more than id)',
)

const nested = await findOneRecord('visit', '2', [
  'id',
  'blocks.id',
  'blocks.collection',
  'blocks.item.id',
  'blocks.item.name',
])
const nestedRows = Array.isArray(nested.blocks) ? nested.blocks : []
assert(nestedRows.length > 0, `visit/2 nested blocks expanded (count=${nestedRows.length})`)
assert(
  nestedRows.some((row) => {
    const item = (row as Record<string, unknown>).item
    return (
      item &&
      typeof item === 'object' &&
      String((item as { name?: unknown }).name || '') === 'TTG'
    )
  }),
  "visit/2 nested blocks.item.name === 'TTG'",
)

await pool.end()

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}

console.log('\nok: M2A bare + nested expand path')
