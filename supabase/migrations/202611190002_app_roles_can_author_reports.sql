-- Role-level flag: non-admin users may author reports scoped to their own role.
ALTER TABLE public.app_roles
  ADD COLUMN IF NOT EXISTS can_author_reports boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_roles.can_author_reports IS
  'When true, role members may create/edit/delete report layout settings for their own role only.';

-- Backfill layout_settings.role_id from payload.__meta.role so non-admin
-- layoutSettings reads filter correctly (column was previously always NULL).
UPDATE public.layout_settings
SET role_id = NULLIF(trim(payload->'__meta'->>'role'), ''),
    updated_at = now()
WHERE role_id IS NULL
  AND NULLIF(trim(payload->'__meta'->>'role'), '') IS NOT NULL;
