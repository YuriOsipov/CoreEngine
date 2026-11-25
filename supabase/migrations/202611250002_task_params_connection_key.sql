-- Prefer Setup → Connections naming in scheduled task params.
-- Rename legacy flowKey → connectionKey (keep value). flowKey still accepted by BFF.
UPDATE public.app_scheduled_tasks
SET
  params =
    (params - 'flowKey')
    || jsonb_build_object('connectionKey', params -> 'flowKey'),
  updated_at = now()
WHERE params ? 'flowKey'
  AND NOT (params ? 'connectionKey');
