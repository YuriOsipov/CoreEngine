-- Standard scheduled task: hard-delete archived records past retention.
-- Disabled by default — enable in Setup → Tasks after reviewing retentionDays.
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
) VALUES (
  gen_random_uuid(),
  'purge_archived_records',
  'Hard delete old archived records',
  'purge_archived_records',
  '0 3 * * *',
  '{"rules":[{"interval":"days","every":1,"minute":0,"hour":3,"weekdays":[1],"dayOfMonth":1,"cron":""}]}'::jsonb,
  'UTC',
  false,
  '{"retentionDays":90,"limitPerEntity":500}'::jsonb,
  'Permanently delete archived records older than the retention window (date_updated).',
  NULL
)
ON CONFLICT (key) DO NOTHING;
