-- Org-wide company profile / locale settings (Setup → General).
CREATE TABLE IF NOT EXISTS public.org_settings (
  setting_key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.org_settings IS
  'Tenant company profile and locale defaults (language, currency, date formats, timezone).';
