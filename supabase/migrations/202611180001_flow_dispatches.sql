-- Failed outbound flow runs (record automations, /flows/trigger, scheduled notify).
-- Setup → Flows lists recent rows. Successes are not stored.

CREATE TABLE IF NOT EXISTS public.app_flow_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_key text NOT NULL,
  source text NOT NULL DEFAULT 'flow',
  status text NOT NULL,
  collection text,
  record_id text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_flow_dispatches_status_chk CHECK (status IN ('error', 'success'))
);

CREATE INDEX IF NOT EXISTS app_flow_dispatches_failed_idx
  ON public.app_flow_dispatches (created_at DESC)
  WHERE status = 'error';

COMMENT ON TABLE public.app_flow_dispatches IS
  'Failed runLocalFlow attempts. Rows older than 90 days are deleted on the next failure insert.';
