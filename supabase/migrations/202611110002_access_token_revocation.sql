-- Access-token revocation for the BFF (JWTs are short-lived but must die on
-- logout / password change, not only at expiry).

-- Tokens with iat earlier than this second are rejected (password change / admin reset).
ALTER TABLE public.app_user_credentials
  ADD COLUMN IF NOT EXISTS tokens_valid_after timestamptz;

-- Per-token denylist (logout). Rows are pruned once the token would have expired anyway.
CREATE TABLE IF NOT EXISTS public.app_revoked_access_tokens (
  jti text PRIMARY KEY,
  user_id uuid,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_revoked_access_tokens_expires_at
  ON public.app_revoked_access_tokens (expires_at);
