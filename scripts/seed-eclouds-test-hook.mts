/**
 * Register http flow trigger → eclouds test_hook webhook.
 * Usage: npx tsx scripts/seed-eclouds-test-hook.mts
 */
import { pool, query } from '../crm-bff/src/db/pool.ts'

const FLOW_KEY = 'test_hook'
const url = 'https://integrations.eclouds.co:8445/api2/test_hook'
const config = {
  url,
  method: 'POST',
  headers: { Accept: 'application/json' },
}

await query(
  `INSERT INTO public.app_flow_triggers (key, handler, enabled, description, config)
   VALUES ($1, 'http', true, $2, $3::jsonb)
   ON CONFLICT (key) DO UPDATE SET
     handler = EXCLUDED.handler,
     enabled = true,
     description = EXCLUDED.description,
     config = EXCLUDED.config,
     updated_at = now()`,
  [
    FLOW_KEY,
    'Forward automation payload to eclouds test_hook',
    JSON.stringify(config),
  ],
)

const rows = await query<{
  key: string
  handler: string
  enabled: boolean
  config: unknown
}>(
  `SELECT key, handler, enabled, config
   FROM public.app_flow_triggers
   WHERE key = $1`,
  [FLOW_KEY],
)

console.log(JSON.stringify(rows[0] ?? null, null, 2))
await pool.end()
