/**
 * One-shot: assign Auto Number `name` values to existing rows that are blank.
 * Uses the same counters/format as create-time applyAutoNumbersOnCreate.
 *
 * Usage: npx tsx scripts/backfill-auto-names.ts
 */
import { query } from '../src/db/pool.ts'
import { formatAutoNumber } from '../src/computed/autoNumberFormat.ts'
import { ensureAutoNumberCounter } from '../src/computed/applyAutoNumber.ts'
import { quoteIdent } from '../src/schema/crmStorage.ts'

type AutoNameField = {
  field_id: string
  entity_api_name: string
  backend_target: string
  display_format: string
  starting_number: number
  id_field: string
}

async function loadAutoNameFields(): Promise<AutoNameField[]> {
  const rows = await query<{
    field_id: string
    entity_api_name: string
    backend_target: string
    display_format: string
    starting_number: number
    backend_config: unknown
  }>(
    `SELECT
       f.id::text AS field_id,
       e.api_name AS entity_api_name,
       COALESCE(e.backend_target, 'SUPABASE') AS backend_target,
       COALESCE(f.options->'autoNumber'->>'displayFormat', '{0000}') AS display_format,
       COALESCE((f.options->'autoNumber'->>'startingNumber')::int, 1) AS starting_number,
       e.backend_config
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.deleted_at IS NULL
       AND upper(COALESCE(e.backend_target, '')) <> 'PLATFORM'
       AND f.api_name = 'name'
       AND COALESCE(f.options->>'computeMode', '') = 'autoNumber'
     ORDER BY e.api_name`,
  )

  return rows.map((row) => {
    const cfg =
      row.backend_config && typeof row.backend_config === 'object'
        ? (row.backend_config as Record<string, unknown>)
        : {}
    const hasura =
      cfg.hasura && typeof cfg.hasura === 'object'
        ? (cfg.hasura as Record<string, unknown>)
        : {}
    const idField =
      typeof hasura.idField === 'string' && hasura.idField.trim()
        ? hasura.idField.trim()
        : 'id'
    return {
      field_id: row.field_id,
      entity_api_name: row.entity_api_name,
      backend_target: row.backend_target,
      display_format: row.display_format,
      starting_number: row.starting_number,
      id_field: idField,
    }
  })
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'crm_schema' AND table_name = $1
     LIMIT 1`,
    [table],
  )
  return rows.length > 0
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'crm_schema'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [table, column],
  )
  return rows.length > 0
}

async function allocateNext(
  fieldId: string,
  startingNumber: number,
): Promise<number> {
  await ensureAutoNumberCounter(fieldId, startingNumber)
  const rows = await query<{ allocated: string }>(
    `UPDATE public.field_auto_number_counters
     SET next_value = next_value + 1, updated_at = now()
     WHERE field_id = $1::uuid
     RETURNING (next_value - 1)::text AS allocated`,
    [fieldId],
  )
  return Math.trunc(Number(rows[0]?.allocated))
}

async function backfillEntity(field: AutoNameField): Promise<{
  entity: string
  updated: number
  skipped: number
  error?: string
}> {
  const entity = field.entity_api_name
  if (!(await tableExists(entity))) {
    return { entity, updated: 0, skipped: 0, error: 'no crm_schema table' }
  }
  if (!(await columnExists(entity, 'name'))) {
    return { entity, updated: 0, skipped: 0, error: 'no name column' }
  }

  const idCol = (await columnExists(entity, field.id_field))
    ? field.id_field
    : (await columnExists(entity, 'record_id'))
      ? 'record_id'
      : (await columnExists(entity, 'id'))
        ? 'id'
        : null
  if (!idCol) {
    return { entity, updated: 0, skipped: 0, error: 'no id/record_id column' }
  }
  const createdCol = (await columnExists(entity, 'created_at'))
    ? 'created_at'
    : (await columnExists(entity, 'date_created'))
      ? 'date_created'
      : null

  const orderExpr = createdCol
    ? `${quoteIdent(createdCol)} NULLS LAST, ${quoteIdent(idCol)}`
    : quoteIdent(idCol)

  const emptyRows = await query<Record<string, unknown>>(
    `SELECT ${quoteIdent(idCol)} AS id
            ${createdCol ? `, ${quoteIdent(createdCol)} AS created_at` : ''}
     FROM crm_schema.${quoteIdent(entity)}
     WHERE name IS NULL OR btrim(name) = ''
     ORDER BY ${orderExpr}`,
  )

  let updated = 0
  for (const row of emptyRows) {
    const id = row.id
    if (id === null || id === undefined || id === '') continue

    const createdRaw = row.created_at
    const createdAt =
      typeof createdRaw === 'string' || createdRaw instanceof Date
        ? new Date(createdRaw as string | Date)
        : new Date()
    const safeCreated = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt
    const sequence = await allocateNext(field.field_id, field.starting_number)
    const name = formatAutoNumber(field.display_format, sequence, safeCreated)

    await query(
      `UPDATE crm_schema.${quoteIdent(entity)}
       SET name = $1
       WHERE ${quoteIdent(idCol)} = $2
         AND (name IS NULL OR btrim(name) = '')`,
      [name, String(id)],
    )
    updated += 1
  }

  return { entity, updated, skipped: 0 }
}

async function reloadHasuraMetadata(): Promise<void> {
  const url = (
    process.env.HASURA_GRAPHQL_URL ||
    process.env.HASURA_URL ||
    'http://localhost:8080'
  )
    .replace(/\/v1\/graphql\/?$/, '')
    .replace(/\/$/, '')
  const secret = (process.env.HASURA_ADMIN_SECRET || 'myadminsecretkey').trim()
  try {
    const res = await fetch(`${url}/v1/metadata`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hasura-admin-secret': secret,
      },
      body: JSON.stringify({ type: 'reload_metadata', args: { reload_remote_schemas: true } }),
    })
    const body = await res.text()
    console.log(`Hasura reload_metadata: ${res.status} ${body.slice(0, 200)}`)
  } catch (e) {
    console.warn(
      'Hasura reload skipped:',
      e instanceof Error ? e.message : e,
    )
  }
}

async function main() {
  const fields = await loadAutoNameFields()
  console.log(`Auto-number name fields: ${fields.length}`)
  const summary = []
  for (const field of fields) {
    process.stdout.write(`Backfilling ${field.entity_api_name}... `)
    const result = await backfillEntity(field)
    summary.push(result)
    if (result.error) console.log(`skip (${result.error})`)
    else console.log(`updated ${result.updated}`)
  }
  await reloadHasuraMetadata()
  console.log('\nSUMMARY')
  console.log(JSON.stringify(summary, null, 2))
  const total = summary.reduce((sum, row) => sum + (row.updated || 0), 0)
  console.log(`Total names assigned: ${total}`)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
