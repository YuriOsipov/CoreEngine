-- Enforce append-only semantics on public.config_audits.
--
-- Two layouts exist:
-- 1) Migrations run as coreengine_app (minimal Compose) → app owns the table.
--    REVOKE from self is weak (owner can re-GRANT); a trigger is the real gate.
-- 2) Table owned by postgres (common when kernel was migrated as bootstrap
--    superuser) → only the owner/grantor can CREATE TRIGGER and REVOKE
--    privileges granted by postgres. Re-run this file as postgres if migrate
--    first ran as coreengine_app (triggers skipped + REVOKE is a no-op for
--    privileges the app role did not grant).

CREATE OR REPLACE FUNCTION public.config_audits_forbid_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'public.config_audits is append-only (UPDATE/DELETE/TRUNCATE forbidden)'
    USING ERRCODE = '42501'; -- insufficient_privilege
END;
$$;

DO $$
DECLARE
  owner_name text;
  is_super boolean := false;
BEGIN
  SELECT tableowner
    INTO owner_name
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename = 'config_audits';

  SELECT rolsuper INTO is_super FROM pg_roles WHERE rolname = current_user;

  IF owner_name IS NULL THEN
    RAISE NOTICE 'public.config_audits missing — skip append-only triggers';
    RETURN;
  END IF;

  IF is_super OR owner_name = current_user THEN
    EXECUTE 'DROP TRIGGER IF EXISTS config_audits_append_only ON public.config_audits';
    EXECUTE $trig$
      CREATE TRIGGER config_audits_append_only
        BEFORE UPDATE OR DELETE ON public.config_audits
        FOR EACH ROW
        EXECUTE FUNCTION public.config_audits_forbid_mutation()
    $trig$;

    -- TRUNCATE does not fire row-level DELETE triggers.
    EXECUTE 'DROP TRIGGER IF EXISTS config_audits_append_only_truncate ON public.config_audits';
    EXECUTE $trig$
      CREATE TRIGGER config_audits_append_only_truncate
        BEFORE TRUNCATE ON public.config_audits
        FOR EACH STATEMENT
        EXECUTE FUNCTION public.config_audits_forbid_mutation()
    $trig$;
  ELSE
    RAISE NOTICE
      'skipping config_audits append-only triggers (table owner=%, current_user=%)',
      owner_name,
      current_user;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coreengine_app') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.config_audits FROM coreengine_app';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.config_audits TO coreengine_app';
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'config_audits_id_seq'
        AND c.relkind = 'S'
    ) THEN
      EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.config_audits_id_seq TO coreengine_app';
    END IF;
  END IF;
END
$$;

DO $$
DECLARE
  owner_name text;
  is_super boolean := false;
BEGIN
  SELECT tableowner
    INTO owner_name
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename = 'config_audits';
  SELECT rolsuper INTO is_super FROM pg_roles WHERE rolname = current_user;
  IF owner_name IS NOT NULL AND (is_super OR owner_name = current_user) THEN
    EXECUTE $c$
      COMMENT ON TABLE public.config_audits IS
        'Append-only log of Setup/registry mutations. UPDATE/DELETE/TRUNCATE blocked by trigger when installable; coreengine_app granted SELECT+INSERT only.'
    $c$;
  END IF;
END
$$;
