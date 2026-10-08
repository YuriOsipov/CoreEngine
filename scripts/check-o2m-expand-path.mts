/**
 * Assert O2M alias + nested junction FK expand.
 *
 * Usage: npm run bff:check-o2m-expand
 */
import { pool } from '../crm-bff/src/db/pool.ts'
import {
  clearRecordRelationsCache,
  loadM2ORelations,
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

const itemItemM2O = await loadM2ORelations('item_item')
assert(
  itemItemM2O.some(
    (row) => row.fieldApiName === 'related_item_id' && row.relatedEntityApiName === 'item',
  ),
  'item_item.related_item_id treated as M2O (M2M junction FK)',
)

const item = await findOneRecord('item', '1', [
  'id',
  'items.id',
  'items.related_item_id.id',
  'items.related_item_id.name',
])
const itemRows = Array.isArray(item.items) ? item.items : []
assert(itemRows.length > 0, `item/1 items expanded (count=${itemRows.length})`)
assert(
  itemRows.every((row) => {
    const related = (row as Record<string, unknown>).related_item_id
    return related && typeof related === 'object' && 'name' in (related as object)
  }),
  'item/1 items.related_item_id hydrated with name',
)

const form = await findOneRecord('form', '3', [
  'id',
  'roles.id',
  'roles.role_id.id',
  'roles.role_id.name',
])
const roleRows = Array.isArray(form.roles) ? form.roles : []
assert(roleRows.length > 0, `form/3 roles expanded (count=${roleRows.length})`)
assert(
  roleRows.every((row) => {
    const role = (row as Record<string, unknown>).role_id
    return role && typeof role === 'object' && 'name' in (role as object)
  }),
  'form/3 roles.role_id hydrated with name',
)

await pool.end()

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}

console.log('\nok: O2M nested expand path')
