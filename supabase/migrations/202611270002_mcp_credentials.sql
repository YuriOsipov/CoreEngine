-- Dedicated MCP credentials (opaque Bearer, not the web session JWT/refresh).
CREATE TABLE IF NOT EXISTS public.app_mcp_credentials (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_users (id) ON DELETE CASCADE,
  label text NOT NULL,
  token_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['read']::text[],
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT app_mcp_credentials_token_hash_key UNIQUE (token_hash),
  CONSTRAINT app_mcp_credentials_label_chk CHECK (char_length(trim(label)) > 0)
);

CREATE INDEX IF NOT EXISTS app_mcp_credentials_user_id_idx
  ON public.app_mcp_credentials (user_id);

CREATE INDEX IF NOT EXISTS app_mcp_credentials_active_idx
  ON public.app_mcp_credentials (expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.app_mcp_credentials IS
  'Opaque MCP Bearer tokens (ce_mcp_…). Shown once at create; hash stored. Independent of web refresh rotation.';
