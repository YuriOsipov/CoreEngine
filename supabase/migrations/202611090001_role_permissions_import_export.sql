-- Import / Export flags on the role permission matrix (per collection).

ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS can_import boolean NOT NULL DEFAULT false;

ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS can_export boolean NOT NULL DEFAULT false;

-- Preserve prior behaviour for existing roles:
-- export ≈ read; import ≈ create or update.
UPDATE public.role_permissions
SET
  can_export = can_read,
  can_import = (can_create OR can_update)
WHERE can_import = false
  AND can_export = false;
