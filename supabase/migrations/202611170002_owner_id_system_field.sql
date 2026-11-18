-- Separate sharing owner (`owner_id`) from audit Created By (`user_created`).
-- Seed the system field on full-profile entities, add typed columns, backfill.

INSERT INTO public.fields (
  entity_id, api_name, label, field_type, interface,
  options, display_options, required, readonly, hidden, sort,
  is_system, is_unique, is_indexed
)
SELECT
  e.id,
  'owner_id',
  'Owner',
  'UUID',
  'select-dropdown-m2o',
  '{}'::jsonb,
  '{}'::jsonb,
  false,
  true,
  false,
  35,
  true,
  false,
  true
FROM public.entities e
JOIN public.fields uc
  ON uc.entity_id = e.id
 AND uc.api_name = 'user_created'
WHERE e.deleted_at IS NULL
ON CONFLICT (entity_id, api_name) DO NOTHING;

-- Typed crm_schema tables that already have user_created.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'crm_schema'
      AND c.column_name = 'user_created'
  LOOP
    EXECUTE format(
      'ALTER TABLE crm_schema.%I ADD COLUMN IF NOT EXISTS owner_id text',
      r.table_name
    );
    EXECUTE format(
      'UPDATE crm_schema.%I
         SET owner_id = user_created
       WHERE owner_id IS NULL
         AND user_created IS NOT NULL',
      r.table_name
    );
  END LOOP;
END $$;

-- JSONB business_records (legacy / opt-in storage).
DO $$
BEGIN
  IF to_regclass('public.business_records') IS NOT NULL THEN
    UPDATE public.business_records
       SET data = data || jsonb_build_object('owner_id', data->>'user_created')
     WHERE data ? 'user_created'
       AND COALESCE(NULLIF(BTRIM(data->>'user_created'), ''), '') <> ''
       AND (
         NOT (data ? 'owner_id')
         OR NULLIF(BTRIM(data->>'owner_id'), '') IS NULL
       );
  END IF;
END $$;
