/**
 * Ensure Auto Number `name` exists + is backfilled on the Hasura Postgres DB
 * (`hasura` on :5434), which is separate from the BFF registry DB (`supabase`).
 *
 * Usage: npx tsx scripts/backfill-hasura-auto-names.ts
 */
import pg from 'pg'
import { formatAutoNumber } from '../src/computed/autoNumberFormat.ts'

function hasuraDatabaseUrl(): string {
  const fromEnv = (process.env.HASURA_DATABASE_URL || '').trim()
  if (fromEnv) return fromEnv
  const registry =
    process.env.DATABASE_URL ||
    'postgresql://postgres:1@localhost:5434/supabase'
  return registry.replace(/\/supabase(\?|$)/, '/hasura$1')
}

function registryDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    'postgresql://postgres:1@localhost:5434/supabase'
  )
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`
}

type AutoNameField = {
  field_id: string
  entity_api_name: string
  display_format: string
  starting_number: number
  id_field: string
}

async function loadAutoNameFields(registry: pg.Pool): Promise<AutoNameField[]> {
  const { rows } = await registry.query(
    `SELECT
       f.id::text AS field_id,
       e.api_name AS entity_api_name,
       COALESCE(f.options->'autoNumber'->>'displayFormat', '{0000}') AS display_format,
       COALESCE((f.options->'autoNumber'->>'startingNumber')::int, 1) AS starting_number,
       e.backend_config
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.deleted_at IS NULL
       AND upper(COALESCE(e.backend_target, '')) = 'HASURA'
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
        : 'record_id'
    return {
      field_id: String(row.field_id),
      entity_api_name: String(row.entity_api_name),
      display_format: String(row.display_format || '{0000}'),
      starting_number: Number(row.starting_number) || 1,
      id_field: idField,
    }
  })
}

async function ensureCounter(
  registry: pg.Pool,
  fieldId: string,
  startingNumber: number,
): Promise<void> {
  await registry.query(
    `INSERT INTO public.field_auto_number_counters (field_id, next_value)
     VALUES ($1::uuid, $2)
     ON CONFLICT (field_id) DO UPDATE SET
       next_value = GREATEST(
         public.field_auto_number_counters.next_value,
         EXCLUDED.next_value
       ),
       updated_at = now()`,
    [fieldId, Math.max(0, Math.trunc(startingNumber))],
  )
}

async function allocateNext(
  registry: pg.Pool,
  fieldId: string,
  startingNumber: number,
): Promise<number> {
  await ensureCounter(registry, fieldId, startingNumber)
  const { rows } = await registry.query(
    `UPDATE public.field_auto_number_counters
     SET next_value = next_value + 1, updated_at = now()
     WHERE field_id = $1::uuid
     RETURNING (next_value - 1)::text AS allocated`,
    [fieldId],
  )
  return Math.trunc(Number(rows[0]?.allocated))
}

async function tableExists(db: pg.Pool, table: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'crm_schema' AND table_name = $1
     LIMIT 1`,
    [table],
  )
  return rows.length > 0
}

async function columnExists(
  db: pg.Pool,
  table: string,
  column: string,
): Promise<boolean> {
  const { rows } = await db.query(
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

async function ensureNameColumn(db: pg.Pool, table: string): Promise<void> {
  await db.query(
    `ALTER TABLE crm_schema.${quoteIdent(table)}
     ADD COLUMN IF NOT EXISTS name text`,
  )
  const idx =
    'uq_' +
    table.toLowerCase().replace(/[^a-z0-9_]+/g, '_') +
    '_field_name'
  try {
    await db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(idx)}
       ON crm_schema.${quoteIdent(table)} (name)
       WHERE status IS DISTINCT FROM 'archived'`,
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn(`  index ${idx}: ${message}`)
  }
}

async function backfillEntity(
  hasuraDb: pg.Pool,
  registry: pg.Pool,
  field: AutoNameField,
): Promise<{ entity: string; updated: number; error?: string }> {
  const entity = field.entity_api_name
  if (!(await tableExists(hasuraDb, entity))) {
    return { entity, updated: 0, error: 'no table' }
  }

  await ensureNameColumn(hasuraDb, entity)

  const idCol = (await columnExists(hasuraDb, entity, field.id_field))
    ? field.id_field
    : (await columnExists(hasuraDb, entity, 'record_id'))
      ? 'record_id'
      : (await columnExists(hasuraDb, entity, 'id'))
        ? 'id'
        : null
  if (!idCol) return { entity, updated: 0, error: 'no id column' }

  const createdCol = (await columnExists(hasuraDb, entity, 'created_at'))
    ? 'created_at'
    : (await columnExists(hasuraDb, entity, 'date_created'))
      ? 'date_created'
      : null
  const orderExpr = createdCol
    ? `${quoteIdent(createdCol)} NULLS LAST, ${quoteIdent(idCol)}`
    : quoteIdent(idCol)

  const { rows: emptyRows } = await hasuraDb.query(
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
        ? new Date(createdRaw)
        : new Date()
    const safeCreated = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt
    const sequence = await allocateNext(
      registry,
      field.field_id,
      field.starting_number,
    )
    const name = formatAutoNumber(field.display_format, sequence, safeCreated)
    await hasuraDb.query(
      `UPDATE crm_schema.${quoteIdent(entity)}
       SET name = $1
       WHERE ${quoteIdent(idCol)} = $2
         AND (name IS NULL OR btrim(name) = '')`,
      [name, String(id)],
    )
    updated += 1
  }

  return { entity, updated }
}

async function reloadHasuraMetadata(): Promise<void> {
  const url = (
    process.env.HASURA_GRAPHQL_URL || 'http://localhost:8090/v1/graphql'
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
      body: JSON.stringify({
        type: 'reload_metadata',
        args: { reload_remote_schemas: true, reload_sources: true },
      }),
    })
    const body = await res.text()
    console.log(`Hasura reload_metadata: ${res.status} ${body.slice(0, 200)}`)
  } catch (e) {
    console.warn('Hasura reload skipped:', e instanceof Error ? e.message : e)
  }
}

async function main() {
  const registryUrl = registryDatabaseUrl()
  const hasuraUrl = hasuraDatabaseUrl()
  console.log(`Registry DB: ${registryUrl.replace(/:[^:@/]+@/, ':***@')}`)
  console.log(`Hasura DB:   ${hasuraUrl.replace(/:[^:@/]+@/, ':***@')}`)

  const registry = new pg.Pool({ connectionString: registryUrl })
  const hasuraDb = new pg.Pool({ connectionString: hasuraUrl })

  try {
    const fields = await loadAutoNameFields(registry)
    console.log(`HASURA auto-number entities: ${fields.length}`)
    const summary = []
    for (const field of fields) {
      process.stdout.write(`Backfilling ${field.entity_api_name}... `)
      const result = await backfillEntity(hasuraDb, registry, field)
      summary.push(result)
      if (result.error) console.log(`skip (${result.error})`)
      else console.log(`updated ${result.updated}`)
    }
    await reloadHasuraMetadata()
    console.log('\nSUMMARY')
    console.log(JSON.stringify(summary, null, 2))
    console.log(
      `Total names assigned: ${summary.reduce((s, r) => s + (r.updated || 0), 0)}`,
    )
  } finally {
    await registry.end()
    await hasuraDb.end()
  }
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
