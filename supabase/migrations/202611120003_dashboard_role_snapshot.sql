-- Dashboard role visibility + persisted aggregate source snapshots.
ALTER TABLE public.app_dashboards
  ADD COLUMN IF NOT EXISTS role_id text,
  ADD COLUMN IF NOT EXISTS source_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz;

CREATE INDEX IF NOT EXISTS app_dashboards_role_id_idx
  ON public.app_dashboards (role_id);
