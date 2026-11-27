-- Admin debug: store outbound HTTP status + truncated request body on flow runs.
ALTER TABLE public.app_flow_dispatches
  ADD COLUMN IF NOT EXISTS http_status integer,
  ADD COLUMN IF NOT EXISTS request_body text;

COMMENT ON COLUMN public.app_flow_dispatches.http_status IS
  'Upstream HTTP status (or BFF LocalFlowError status) when the run failed or completed.';
COMMENT ON COLUMN public.app_flow_dispatches.request_body IS
  'Truncated JSON body sent to the outbound webhook (no auth headers).';
