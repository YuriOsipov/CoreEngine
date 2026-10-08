/**
 * Migrate CRM entity rows from public.business_records → crm_schema.<table>
 * (Option C typed per-entity tables).
 *
 * DDL for columns/indexes/FKs is shared with schema-sync (`ddlSync.ts`).
 * Prefer Setup → Schema sync for day-to-day ADD COLUMN; use this script for
 * initial cutover, JSONB copy, --flip/--drain, or CLI apply.
 *
 * Usage (from repo root):
 *   npm run registry:migrate-entity-records -- languages
 *   npm run registry:migrate-entity-records -- languages,patient --apply
 *   npm run registry:migrate-entity-records -- --all --apply --flip
 *   npm run registry:migrate-entity-records -- --all --apply --flip --drain --fk
 *
 * Flags:
 *   --apply   Execute DDL + upsert (default is dry-run)
 *   --all     Migrate every SUPABASE entity (skips PLATFORM)
 *   --flip    Set entities.backend_config storage=typed after copy
 *   --drain   DELETE matching rows from business_records after flip
 *   --fk      Add M2O FOREIGN KEY constraints when related typed table exists
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'
import {
  CRM_SCHEMA,
  coercePromotedValue,
  crmQualifiedTable,
  loadPromotedFields,
  quoteIdent,
  type CrmPromotedField,
} from '../crm-bff/src/schema/crmStorage.ts'
import {
  applyDdlActions,
  planEntityDdlSync,
  summarizeDdlActions,
} from '../crm-bff/src/schema/ddlSync.ts'
import {
  applyUniqueIndexActions,
  planUniqueIndexActions,
} from '../crm-bff/src/schema/uniqueGroups.ts'

const args = process.argv.slice(2).filter((a) => a !== '--')
const apply = args.includes('--apply')
const all = args.includes('--all')
const flip = args.includes('--flip')
const drain = args.includes('--drain')
const addFk = args.includes('--fk')

const entityArgs = args.filter((a) => !a.startsWith('--'))
const entityList = entityArgs
  .flatMap((a) => a.split(','))
  .map((a) => a.trim())
  .filter(Boolean)

if (drain && !flip) {
  console.error('--drain requires --flip (refuse draining while reads still use JSONB).')
  process.exit(1)
}

if (!all && !entityList.length) {
  console.error(
    [
      'Usage:',
      '  npm run registry:migrate-entity-records -- <entity>[,entity...] [--apply] [--flip] [--drain] [--fk]',
      '  npm run registry:migrate-entity-records -- --all [--apply] [--flip] [--drain] [--fk]',
    ].join('\n'),
  )
  process.exit(1)
}

type EntityRow = {
  api_name: string
  backend_target: string
  backend_config: Record<string, unknown> | null
}

async function listTargetEntities(): Promise<EntityRow[]> {
  if (all) {
    return query<EntityRow>(
      `SELECT api_name, backend_target, backend_config
       FROM public.entities
       WHERE deleted_at IS NULL
         AND backend_target = 'SUPABASE'
       ORDER BY api_name`,
    )
  }

  const rows = await query<EntityRow>(
    `SELECT api_name, backend_target, backend_config
     FROM public.entities
     WHERE deleted_at IS NULL
       AND api_name = ANY($1::text[])
     ORDER BY api_name`,
    [entityList],
  )
  const found = new Set(rows.map((r) => r.api_name))
  for (const name of entityList) {
    if (!found.has(name)) {
      throw new Error(`Entity not found in registry: ${name}`)
    }
  }
  for (const row of rows) {
    if (row.backend_target === 'PLATFORM') {
      throw new Error(`Refusing PLATFORM entity: ${row.api_name}`)
    }
    if (row.backend_target !== 'SUPABASE') {
      throw new Error(
        `Entity ${row.api_name} backend_target=${row.backend_target}; expected SUPABASE`,
      )
    }
  }
  return rows
}

async function upsertRows(
  entityApiName: string,
  promoted: CrmPromotedField[],
): Promise<{ source: number; upserted: number }> {
  const sourceRows = await query<{
    record_id: string
    status: string
    data: Record<string, unknown>
    created_at: string
    updated_at: string
  }>(
    `SELECT record_id, status, data, created_at::text, updated_at::text
     FROM public.business_records
     WHERE entity_api_name = $1
     ORDER BY record_id`,
    [entityApiName],
  )

  if (!apply) {
    return { source: sourceRows.length, upserted: 0 }
  }

  const table = crmQualifiedTable(
    { schema: CRM_SCHEMA, table: entityApiName },
    entityApiName,
  )
  let upserted = 0

  for (const row of sourceRows) {
    const data =
      row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? row.data
        : {}
    const promotedCols = promoted.map((f) => quoteIdent(f.apiName))
    const promotedVals = promoted.map((f) => coercePromotedValue(f, data[f.apiName]))
    const placeholders = promoted.map((f, i) => {
      const idx = 6 + i
      return f.pgType === 'jsonb' ? `$${idx}::jsonb` : `$${idx}`
    })
    const updateSet = [
      'status = EXCLUDED.status',
      'data = EXCLUDED.data',
      'created_at = EXCLUDED.created_at',
      'updated_at = EXCLUDED.updated_at',
      ...promoted.map((f) => `${quoteIdent(f.apiName)} = EXCLUDED.${quoteIdent(f.apiName)}`),
    ]

    const colSql = [
      'record_id',
      'status',
      'data',
      'created_at',
      'updated_at',
      ...promotedCols,
    ].join(', ')
    const valSql = [
      '$1',
      '$2',
      '$3::jsonb',
      '$4::timestamptz',
      '$5::timestamptz',
      ...placeholders,
    ].join(', ')

    await query(
      `INSERT INTO ${table} (${colSql})
       VALUES (${valSql})
       ON CONFLICT (record_id) DO UPDATE SET ${updateSet.join(', ')}`,
      [
        row.record_id,
        row.status,
        JSON.stringify(data),
        row.created_at,
        row.updated_at,
        ...promotedVals,
      ],
    )
    upserted += 1
  }

  return { source: sourceRows.length, upserted }
}

async function flipEntity(entityApiName: string): Promise<void> {
  const config = {
    storage: 'typed',
    schema: CRM_SCHEMA,
    table: entityApiName,
  }
  if (!apply) return
  await query(
    `UPDATE public.entities
     SET backend_config = COALESCE(backend_config, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     WHERE api_name = $1 AND deleted_at IS NULL`,
    [entityApiName, JSON.stringify(config)],
  )
}

async function drainEntity(entityApiName: string): Promise<number> {
  if (!apply) {
    const rows = await query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.business_records
       WHERE entity_api_name = $1`,
      [entityApiName],
    )
    return Number(rows[0]?.count ?? 0)
  }
  const deleted = await query<{ record_id: string }>(
    `DELETE FROM public.business_records
     WHERE entity_api_name = $1
     RETURNING record_id`,
    [entityApiName],
  )
  return deleted.length
}

const entities = await listTargetEntities()
const summary: Array<Record<string, unknown>> = []

for (const entity of entities) {
  const promoted = await loadPromotedFields(entity.api_name)
  const ddlActions = await planEntityDdlSync(entity.api_name, {
    includeFk: addFk,
    includeBackfill: true,
  })
  const meaningfulDdl = summarizeDdlActions(ddlActions)
  if (apply) {
    const result = await applyDdlActions(ddlActions)
    if (result.errors.length) {
      for (const err of result.errors) {
        console.warn(`FK warn ${entity.api_name}: ${err.error}`)
      }
    }
  }

  const uniqueActions = await planUniqueIndexActions(entity.api_name)
  if (apply && uniqueActions.length) {
    await applyUniqueIndexActions(uniqueActions)
  }
  const copy = await upsertRows(entity.api_name, promoted)
  if (flip) {
    await flipEntity(entity.api_name)
  }
  let drained = 0
  if (drain) {
    drained = await drainEntity(entity.api_name)
  }

  const targetCount = apply
    ? Number(
        (
          await query<{ count: string }>(
            `SELECT count(*)::text AS count FROM ${crmQualifiedTable(
              { schema: CRM_SCHEMA, table: entity.api_name },
              entity.api_name,
            )}`,
          )
        )[0]?.count ?? 0,
      )
    : null

  summary.push({
    entity: entity.api_name,
    promotedFields: promoted.map((f) => f.apiName),
    sourceRows: copy.source,
    upserted: copy.upserted,
    targetRows: targetCount,
    flipped: flip,
    drained: drain ? drained : undefined,
    ddlActions: meaningfulDdl.map((a) => ({ type: a.type, field: a.fieldApiName, message: a.message })),
    uniqueIndexActions: uniqueActions.map((a) => ({ type: a.type, index: a.indexName })),
  })

  console.log(
    `${apply ? 'OK' : 'DRY'} ${entity.api_name}: source=${copy.source}` +
      (apply ? ` upserted=${copy.upserted} target=${targetCount}` : '') +
      (meaningfulDdl.length ? ` ddl=${meaningfulDdl.length}` : '') +
      (uniqueActions.length ? ` unique=${uniqueActions.length}` : '') +
      (flip ? ' flipped' : '') +
      (drain ? ` drained=${drained}` : ''),
  )
}

console.log(
  JSON.stringify(
    {
      mode: apply ? 'apply' : 'dry-run',
      flip,
      drain,
      fk: addFk,
      schema: CRM_SCHEMA,
      entities: summary,
    },
    null,
    2,
  ),
)

if (!apply) {
  console.log('Dry-run only. Re-run with --apply to create tables and copy rows.')
  console.log(
    'Day-to-day column DDL: Setup → Schema sync, or GraphQL runSchemaSync(entity, dryRun: false).',
  )
}

await pool.end()
