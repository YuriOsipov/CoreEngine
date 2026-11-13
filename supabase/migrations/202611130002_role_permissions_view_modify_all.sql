-- Per-object View All / Modify All for owner row security bypass (SMB/mid managers).
-- View All: list/get/aggregate any row on the object (still needs can_read).
-- Modify All: update/delete/restore any row (still needs can_update / can_delete);
--   implies View All for row-security checks.

ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS can_view_all boolean NOT NULL DEFAULT false;

ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS can_modify_all boolean NOT NULL DEFAULT false;
