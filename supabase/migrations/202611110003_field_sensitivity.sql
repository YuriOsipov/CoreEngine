-- Field-level security via sensitivity tiers.
-- fields.sensitivity: 0 = none, 1 = restricted, 2 = confidential.
-- role_permissions.max_*_sensitivity: highest tier a role may read / edit per entity.
-- Admin roles bypass. Defaults keep every existing field visible and every role
-- out of marked fields until an admin opts in.

ALTER TABLE public.fields
  ADD COLUMN IF NOT EXISTS sensitivity smallint NOT NULL DEFAULT 0;

ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS max_read_sensitivity smallint NOT NULL DEFAULT 0;

ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS max_edit_sensitivity smallint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fields_sensitivity_range'
  ) THEN
    ALTER TABLE public.fields
      ADD CONSTRAINT fields_sensitivity_range CHECK (sensitivity BETWEEN 0 AND 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_sensitivity_range'
  ) THEN
    ALTER TABLE public.role_permissions
      ADD CONSTRAINT role_permissions_sensitivity_range CHECK (
        max_read_sensitivity BETWEEN 0 AND 2
        AND max_edit_sensitivity BETWEEN 0 AND 2
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_edit_le_read'
  ) THEN
    ALTER TABLE public.role_permissions
      ADD CONSTRAINT role_permissions_edit_le_read
        CHECK (max_edit_sensitivity <= max_read_sensitivity);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fields_sensitive_idx
  ON public.fields (entity_id)
  WHERE sensitivity > 0;
