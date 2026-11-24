/**
 * Boot / registry gate: `config_audits` append-only triggers must exist.
 *
 * Migration `202611240001_config_audits_append_only.sql` only RAISE NOTICE and
 * still succeeds when the migrate role does not own the table — so a green
 * migrate is not proof the triggers were installed.
 */
import { query } from '../db/pool.js'

export const CONFIG_AUDITS_APPEND_ONLY_TRIGGERS = [
  'config_audits_append_only',
  'config_audits_append_only_truncate',
] as const

export type AssertConfigAuditsAppendOnlyOptions = {
  /**
   * When true, missing `public.config_audits` also fails.
   * Default: required in production; optional elsewhere (pre-migrate local).
   */
  requireTable?: boolean
}

async function tableExists(): Promise<boolean> {
  const rows = await query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename = 'config_audits'
     ) AS present`,
  )
  return Boolean(rows[0]?.present)
}

async function missingTriggers(): Promise<string[]> {
  const rows = await query<{ tgname: string }>(
    `SELECT t.tgname
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'config_audits'
       AND NOT t.tgisinternal
       AND t.tgname = ANY($1::text[])`,
    [CONFIG_AUDITS_APPEND_ONLY_TRIGGERS],
  )
  const found = new Set(rows.map((row) => row.tgname))
  return CONFIG_AUDITS_APPEND_ONLY_TRIGGERS.filter((name) => !found.has(name))
}

/**
 * Refuse boot (or fail registry:check) when append-only enforcement is absent.
 */
export async function assertConfigAuditsAppendOnlyReady(
  options: AssertConfigAuditsAppendOnlyOptions = {},
): Promise<void> {
  const requireTable =
    options.requireTable === true || process.env.NODE_ENV === 'production'

  const exists = await tableExists()
  if (!exists) {
    if (!requireTable) return
    throw new Error(
      'Refusing to start: public.config_audits is missing. Apply migrations ' +
        '202611230001_config_audits.sql and ' +
        '202611240001_config_audits_append_only.sql ' +
        '(npm run registry:migrate / registry:migrate:node).',
    )
  }

  const missing = await missingTriggers()
  if (missing.length === 0) return

  throw new Error(
    `Refusing to start: public.config_audits append-only trigger(s) missing (${missing.join(', ')}). ` +
      'Migration 202611240001_config_audits_append_only.sql only RAISE NOTICE and still succeeds ' +
      'when the migrate role does not own the table. Re-run that migration as the table owner ' +
      '(or postgres), then restart / re-check.',
  )
}
