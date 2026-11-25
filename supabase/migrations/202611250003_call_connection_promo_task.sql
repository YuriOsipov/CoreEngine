-- Call connection job type + promo sync via Activepieces Connection.

-- Legacy aliases → call_connection
UPDATE public.app_scheduled_tasks
SET
  job_type = 'call_connection',
  updated_at = now()
WHERE job_type = 'send_notification';

-- In-process sync_promo_prices → Call connection (Activepieces)
UPDATE public.app_scheduled_tasks
SET
  job_type = 'call_connection',
  params = jsonb_build_object(
    'connectionKey', 'sync_promo_prices',
    'payload', COALESCE(params, '{}'::jsonb)
  ),
  description = COALESCE(
    NULLIF(trim(description), ''),
    'Sync promo prices via Setup → Connections key sync_promo_prices (Activepieces).'
  ),
  updated_at = now()
WHERE job_type = 'sync_promo_prices';

-- Disabled Connection placeholder — paste Catch Webhook Live URL id after importing
-- docs/activepieces/sync-promo-prices.flow.json, then enable.
INSERT INTO public.app_flow_triggers (key, handler, enabled, description, config)
VALUES (
  'sync_promo_prices',
  'http',
  false,
  'Sync promo prices (Activepieces). Paste flowId from Catch Webhook Live URL, then enable.',
  '{
    "target": "activepieces",
    "flowId": "",
    "sync": true,
    "method": "POST",
    "headers": { "Accept": "application/json" },
    "auth": { "type": "none" }
  }'::jsonb
)
ON CONFLICT (key) DO UPDATE SET
  handler = EXCLUDED.handler,
  description = COALESCE(public.app_flow_triggers.description, EXCLUDED.description),
  config = CASE
    WHEN COALESCE(public.app_flow_triggers.config ->> 'flowId', '') <> ''
      THEN public.app_flow_triggers.config
    ELSE EXCLUDED.config
  END,
  updated_at = now();

-- Ensure a Promo Price updates task exists when none already points at the Connection
INSERT INTO public.app_scheduled_tasks (
  id,
  key,
  name,
  job_type,
  cron,
  schedule,
  timezone,
  enabled,
  params,
  description,
  next_run_at
)
SELECT
  gen_random_uuid(),
  'promo-price-updates',
  'Promo Price updates',
  'call_connection',
  '0 2 * * *',
  '{"rules":[{"interval":"days","every":1,"minute":0,"hour":2,"weekdays":[1],"dayOfMonth":1,"cron":""}]}'::jsonb,
  'UTC',
  false,
  '{"connectionKey":"sync_promo_prices","payload":{}}'::jsonb,
  'Sync promo prices via Setup → Connections key sync_promo_prices (Activepieces).',
  NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.app_scheduled_tasks
  WHERE key = 'promo-price-updates'
     OR key LIKE 'promo-price-updates%'
     OR (
       job_type = 'call_connection'
       AND params ->> 'connectionKey' = 'sync_promo_prices'
     )
);
