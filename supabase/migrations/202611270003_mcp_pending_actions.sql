-- Human-approved MCP actions (retry_message, schema/layout writes).
CREATE TABLE IF NOT EXISTS public.app_mcp_pending_actions (
  id uuid PRIMARY KEY,
  tool_name text NOT NULL,
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  requested_by_user_id uuid NOT NULL REFERENCES public.app_users (id) ON DELETE CASCADE,
  mcp_credential_id uuid REFERENCES public.app_mcp_credentials (id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by_user_id uuid REFERENCES public.app_users (id) ON DELETE SET NULL,
  decision_note text,
  result jsonb,
  CONSTRAINT app_mcp_pending_actions_tool_chk CHECK (
    tool_name IN ('retry_message', 'upsert_object_schema', 'update_role_layout')
  ),
  CONSTRAINT app_mcp_pending_actions_status_chk CHECK (
    status IN ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired')
  ),
  CONSTRAINT app_mcp_pending_actions_summary_chk CHECK (char_length(trim(summary)) > 0)
);

CREATE INDEX IF NOT EXISTS app_mcp_pending_actions_status_idx
  ON public.app_mcp_pending_actions (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS app_mcp_pending_actions_requester_idx
  ON public.app_mcp_pending_actions (requested_by_user_id, requested_at DESC);

COMMENT ON TABLE public.app_mcp_pending_actions IS
  'MCP destructive tools enqueue here; a human admin must approve in Setup → MCP before execution.';
