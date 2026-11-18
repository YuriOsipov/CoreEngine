-- Store IdP tokens on CoreEngine refresh rows so SSO sessions can re-check
-- the IdP on refresh (deprovision without waiting for 30-day TTL).
ALTER TABLE public.app_refresh_tokens
  ADD COLUMN IF NOT EXISTS oidc_access_token text,
  ADD COLUMN IF NOT EXISTS oidc_refresh_token text;

COMMENT ON COLUMN public.app_refresh_tokens.oidc_access_token IS
  'IdP access token from SSO login; used to call userinfo on CoreEngine refresh.';
COMMENT ON COLUMN public.app_refresh_tokens.oidc_refresh_token IS
  'IdP refresh token from SSO login; used to rotate IdP access when userinfo fails.';

-- Cross-instance cache invalidation for field / owner security metadata.
CREATE TABLE IF NOT EXISTS public.app_cache_epochs (
  name text PRIMARY KEY,
  epoch bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_cache_epochs (name, epoch)
VALUES
  ('field_security', 1),
  ('row_level_security', 1)
ON CONFLICT (name) DO NOTHING;
