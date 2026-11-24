-- Append-only audit trail for Setup / registry config changes (admin diligence).
-- Distinct from record Activity & Revision Tracking on business rows.

CREATE TABLE IF NOT EXISTS public.config_audits (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_key text NOT NULL,
  summary text NOT NULL DEFAULT '',
  user_id text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS config_audits_created_at_idx
  ON public.config_audits (created_at DESC);

CREATE INDEX IF NOT EXISTS config_audits_resource_idx
  ON public.config_audits (resource_type, resource_key, created_at DESC);

COMMENT ON TABLE public.config_audits IS
  'Append-only log of Setup/registry mutations (roles, fields, entities, permissions, …). Enforced in 202611240001_config_audits_append_only.sql.';
