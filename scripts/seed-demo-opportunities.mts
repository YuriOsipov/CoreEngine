/**
 * Seed demo Opportunities with opportunity_item lines.
 *
 * Usage (repo root):
 *   npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env ./scripts/seed-demo-opportunities.mts
 *   npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env ./scripts/seed-demo-opportunities.mts --dry-run
 *   npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env ./scripts/seed-demo-opportunities.mts --count=25 --min-lines=10 --max-lines=20
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import { createRecord, updateRecord } from '../crm-bff/src/adapters/records/facade.ts'

const dryRun = process.argv.includes('--dry-run')
const ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function argInt(name: string, fallback: number): number {
  const prefix = `--${name}=`
  const raw = process.argv.find((a) => a.startsWith(prefix))
  if (!raw) return fallback
  const n = Number(raw.slice(prefix.length))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

const oppCount = argInt('count', 25)
const minLines = argInt('min-lines', 10)
const maxLines = Math.max(minLines, argInt('max-lines', 20))

const STAGES = ['prospecting', 'qualified', 'proposal'] as const

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)]!
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function closeDateOffset(daysAhead: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysAhead)
  return d.toISOString().slice(0, 10)
}

const accounts = await query<{ record_id: string; name: string | null }>(
  `SELECT record_id, name
   FROM crm_schema.account
   WHERE NOT is_deleted
   ORDER BY name NULLS LAST`,
)
const items = await query<{
  record_id: string
  name: string | null
  base_price: string | null
}>(
  `SELECT record_id, name, base_price
   FROM crm_schema.item
   WHERE NOT is_deleted AND base_price IS NOT NULL AND base_price > 0
   ORDER BY name NULLS LAST`,
)

if (!accounts.length) {
  console.error('No accounts found — create accounts first.')
  await pool.end()
  process.exit(1)
}
if (!items.length) {
  console.error('No items with base_price found — create catalog items first.')
  await pool.end()
  process.exit(1)
}

console.log(
  `${dryRun ? 'dry-run' : 'seed'}: ${oppCount} opportunities, ${minLines}-${maxLines} lines each` +
    ` (${accounts.length} accounts, ${items.length} priced items)`,
)

let createdOpps = 0
let createdLines = 0

for (let i = 0; i < oppCount; i += 1) {
  const account = pick(accounts)
  const stage = STAGES[i % STAGES.length]!
  const lineCount = randInt(minLines, maxLines)

  const linePlan: Array<{
    itemId: string
    basePrice: number
    price: number
    quantity: number
    total: number
  }> = []

  // Prefer distinct items per opportunity when possible
  const shuffled = [...items].sort(() => Math.random() - 0.5)
  for (let li = 0; li < lineCount; li += 1) {
    const item = shuffled[li % shuffled.length]!
    const basePrice = Number(item.base_price)
    const quantity = randInt(1, 8)
    // Small random discount / markup around base (±10%)
    const price = round2(basePrice * (0.9 + Math.random() * 0.2))
    linePlan.push({
      itemId: item.record_id,
      basePrice: round2(basePrice),
      price,
      quantity,
      total: round2(price * quantity),
    })
  }

  const amount = round2(linePlan.reduce((sum, row) => sum + row.total, 0))

  if (dryRun) {
    console.log(
      `  [dry] opp#${i + 1} account=${account.name} stage=${stage} lines=${lineCount} amount=${amount}`,
    )
    createdOpps += 1
    createdLines += lineCount
    continue
  }

  const opp = await createRecord(
    'opportunity',
    {
      account_id: account.record_id,
      stage,
      close_date: closeDateOffset(randInt(7, 90)),
      amount,
      is_active: true,
    },
    ['id', 'name'],
    { actorUserId: ACTOR },
  )
  const oppId = String(opp.id)
  createdOpps += 1

  for (const line of linePlan) {
    await createRecord(
      'opportunity_item',
      {
        opportunity: oppId,
        item: line.itemId,
        base_price: line.basePrice,
        main_price: line.price,
        price: line.price,
        quantity: line.quantity,
        is_active: true,
      },
      ['id', 'name', 'total'],
      { actorUserId: ACTOR },
    )
    createdLines += 1
  }

  // Re-assert amount after formula totals (create already set it from plan)
  await updateRecord(
    'opportunity',
    oppId,
    { amount },
    ['id', 'name', 'amount'],
    { actorUserId: ACTOR },
  )

  console.log(
    `  created opportunity ${opp.name ?? oppId} — ${lineCount} lines, amount=${amount}`,
  )
}

console.log(`Done: ${createdOpps} opportunities, ${createdLines} lines`)
await pool.end()
