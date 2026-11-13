-- OIDC identity link for external IdP SSO (Keycloak / Auth0 / etc.).
-- Local password credentials remain optional; SSO users may have no password row.

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS oidc_issuer text,
  ADD COLUMN IF NOT EXISTS oidc_subject text;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_oidc_issuer_subject_uidx
  ON public.app_users (oidc_issuer, oidc_subject)
  WHERE oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL;

COMMENT ON COLUMN public.app_users.oidc_issuer IS
  'OIDC issuer (iss) that owns oidc_subject when the user signs in via SSO.';
COMMENT ON COLUMN public.app_users.oidc_subject IS
  'OIDC subject (sub) from the IdP; unique per issuer.';
