-- Carry sealed IdP tokens onto the consumed-refresh row so the 10s reuse grace
-- path can re-issue a CE session without replaying the IdP refresh token.
--
-- `app_refresh_token_consumed` may be owned by the bootstrap superuser on older
-- installs. Run this migration as a role that can ALTER the table (postgres),
-- then hand ownership to the app role when present.

ALTER TABLE public.app_refresh_token_consumed
  ADD COLUMN IF NOT EXISTS oidc_access_token text,
  ADD COLUMN IF NOT EXISTS oidc_refresh_token text;

COMMENT ON COLUMN public.app_refresh_token_consumed.oidc_access_token IS
  'Sealed IdP access token copied from the rotated CE refresh row (grace reuse).';
COMMENT ON COLUMN public.app_refresh_token_consumed.oidc_refresh_token IS
  'Sealed IdP refresh token copied from the rotated CE refresh row (grace reuse).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coreengine_app') THEN
    EXECUTE 'ALTER TABLE public.app_refresh_token_consumed OWNER TO coreengine_app';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Could not reassign app_refresh_token_consumed owner; columns were still added.';
END $$;
