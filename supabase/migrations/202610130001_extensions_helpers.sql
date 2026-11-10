-- CoreEngine platform kernel: extensions + helpers (empty customer DB)
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS crm_schema;

-- Prefer pgcrypto when the role can create it (Supabase often uses schema extensions).
-- On locked-down roles, fall back to PG13+ core pg_catalog.gen_random_uuid().
DO $ext$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'Skipping pgcrypto (insufficient privilege); using core gen_random_uuid()';
    WHEN OTHERS THEN
      BEGIN
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
      EXCEPTION
        WHEN insufficient_privilege THEN
          RAISE NOTICE 'Skipping pgcrypto (insufficient privilege); using core gen_random_uuid()';
        WHEN duplicate_object THEN
          NULL;
        WHEN OTHERS THEN
          NULL;
      END;
  END;
END
$ext$;

-- Ensure adapters that call public./extensions.gen_random_uuid() resolve.
DO $uuid$
BEGIN
  IF to_regprocedure('public.gen_random_uuid()') IS NULL THEN
    EXECUTE $sql$
      CREATE FUNCTION public.gen_random_uuid()
      RETURNS uuid
      LANGUAGE sql
      VOLATILE
      AS $$ SELECT pg_catalog.gen_random_uuid() $$
    $sql$;
  END IF;

  IF to_regprocedure('extensions.gen_random_uuid()') IS NULL THEN
    EXECUTE $sql$
      CREATE FUNCTION extensions.gen_random_uuid()
      RETURNS uuid
      LANGUAGE sql
      VOLATILE
      AS $$ SELECT pg_catalog.gen_random_uuid() $$
    $sql$;
  END IF;
END
$uuid$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
