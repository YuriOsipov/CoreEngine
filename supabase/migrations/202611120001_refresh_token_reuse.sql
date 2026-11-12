-- Consumed refresh-token hashes for reuse detection after rotation.
-- Presenting a previously rotated token revokes every session for that user.

CREATE TABLE IF NOT EXISTS public.app_refresh_token_consumed (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_users (id) ON DELETE CASCADE,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_refresh_token_consumed_user_id_idx
  ON public.app_refresh_token_consumed (user_id);

CREATE INDEX IF NOT EXISTS app_refresh_token_consumed_consumed_at_idx
  ON public.app_refresh_token_consumed (consumed_at);
