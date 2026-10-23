-- Replace object Status + Sort with is_deleted (archive) and is_active.
-- Schedule templates (crm_schedule_template) keep Status. Junctions stay lean.

-- ---------------------------------------------------------------------------
-- Registry fields
-- ---------------------------------------------------------------------------
DELETE FROM public.fields f
USING public.entities e
WHERE f.entity_id = e.id
  AND UPPER(COALESCE(e.backend_target, '')) <> 'PLATFORM'
  AND f.api_name = 'sort';

DELETE FROM public.fields f
USING public.entities e
WHERE f.entity_id = e.id
  AND UPPER(COALESCE(e.backend_target, '')) <> 'PLATFORM'
  AND e.api_name <> 'crm_schedule_template'
  AND f.api_name = 'status';

INSERT INTO public.fields (
  entity_id, api_name, label, field_type, interface,
  options, display_options, required, readonly, hidden, sort,
  is_system, is_unique, is_indexed
)
SELECT e.id, 'is_deleted', 'Is Deleted', 'BOOLEAN', 'boolean',
       '{"default": false}'::jsonb, '{}'::jsonb,
       false, true, true, 10,
       true, false, true
FROM public.entities e
WHERE e.deleted_at IS NULL
  AND UPPER(COALESCE(e.backend_target, 'SUPABASE')) <> 'PLATFORM'
  AND COALESCE(e.backend_config->>'internal', 'false') <> 'true'
  AND e.api_name <> 'crm_schedule_template'
ON CONFLICT (entity_id, api_name) DO NOTHING;

INSERT INTO public.fields (
  entity_id, api_name, label, field_type, interface,
  options, display_options, required, readonly, hidden, sort,
  is_system, is_unique, is_indexed
)
SELECT e.id, 'is_active', 'Is Active', 'BOOLEAN', 'boolean',
       '{"default": true}'::jsonb, '{}'::jsonb,
       false, false, false, 15,
       true, false, false
FROM public.entities e
WHERE e.deleted_at IS NULL
  AND UPPER(COALESCE(e.backend_target, 'SUPABASE')) <> 'PLATFORM'
  AND COALESCE(e.backend_config->>'internal', 'false') <> 'true'
ON CONFLICT (entity_id, api_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Physical tables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.helix_ident_ok(raw text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT raw ~ '^[A-Za-z_][A-Za-z0-9_]*$'
$$;

DO $$
DECLARE
  rec record;
  sch text;
  tbl text;
  idx record;
  newdef text;
  has_status boolean;
  has_data boolean;
BEGIN
  FOR rec IN
    SELECT e.api_name,
           CASE
             WHEN COALESCE(NULLIF(e.backend_config->>'schema', ''), 'crm_schema')
                  IN ('crm.schema', 'crm-schema')
               THEN 'crm_schema'
             ELSE COALESCE(NULLIF(e.backend_config->>'schema', ''), 'crm_schema')
           END AS schema_name,
           COALESCE(NULLIF(e.backend_config->>'table', ''), e.api_name) AS table_name,
           COALESCE(e.backend_config->>'storage', 'typed') AS storage,
           COALESCE(e.backend_config->>'internal', 'false') AS internal
    FROM public.entities e
    WHERE UPPER(COALESCE(e.backend_target, 'SUPABASE')) <> 'PLATFORM'
  LOOP
    IF rec.storage = 'jsonb' THEN
      CONTINUE;
    END IF;
    sch := rec.schema_name;
    tbl := rec.table_name;
    IF NOT public.helix_ident_ok(sch) OR NOT public.helix_ident_ok(tbl) THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = sch AND table_name = tbl
    ) THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = sch AND table_name = tbl AND column_name = 'status'
    ) INTO has_status;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = sch AND table_name = tbl AND column_name = 'data'
    ) INTO has_data;

    IF rec.internal = 'true' THEN
      IF has_status THEN
        EXECUTE format('ALTER TABLE %I.%I DROP COLUMN IF EXISTS status', sch, tbl);
      END IF;
      EXECUTE format('ALTER TABLE %I.%I DROP COLUMN IF EXISTS sort', sch, tbl);
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true',
      sch, tbl
    );

    IF rec.api_name = 'crm_schedule_template' THEN
      IF has_data THEN
        EXECUTE format(
          $q$UPDATE %I.%I
             SET is_active = CASE
               WHEN lower(data->>'is_active') IN ('false', '0') THEN false
               WHEN lower(data->>'is_active') IN ('true', '1') THEN true
               ELSE is_active
             END
             WHERE data ? 'is_active'$q$,
          sch, tbl
        );
        EXECUTE format(
          $q$UPDATE %I.%I SET data = data - 'sort' - 'is_active'$q$,
          sch, tbl
        );
      END IF;
      EXECUTE format('ALTER TABLE %I.%I DROP COLUMN IF EXISTS sort', sch, tbl);
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false',
      sch, tbl
    );

    IF has_status THEN
      EXECUTE format(
        $q$UPDATE %I.%I
           SET is_deleted = true
           WHERE lower(status) = 'archived'$q$,
        sch, tbl
      );
    END IF;
    IF has_data THEN
      EXECUTE format(
        $q$UPDATE %I.%I
           SET is_deleted = true
           WHERE lower(COALESCE(data->>'is_deleted', '')) IN ('true', '1')$q$,
        sch, tbl
      );
      EXECUTE format(
        $q$UPDATE %I.%I
           SET is_active = CASE
             WHEN lower(data->>'is_active') IN ('false', '0') THEN false
             WHEN lower(data->>'is_active') IN ('true', '1') THEN true
             ELSE is_active
           END
           WHERE data ? 'is_active'$q$,
        sch, tbl
      );
    END IF;

    FOR idx IN
      SELECT c.relname AS index_name,
             pg_get_indexdef(i.indexrelid) AS indexdef
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = sch
        AND t.relname = tbl
        AND NOT i.indisprimary
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint cx WHERE cx.conindid = i.indexrelid
        )
        AND pg_get_indexdef(i.indexrelid) ~* 'status|sort'
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS %I.%I', sch, idx.index_name);
      IF idx.indexdef ~* 'status IS DISTINCT FROM' OR idx.indexdef ~* 'status\s*<>' THEN
        newdef := regexp_replace(
          idx.indexdef,
          'WHERE\s+.*$',
          'WHERE (is_deleted IS NOT TRUE)',
          'i'
        );
        IF newdef !~* '\(status\)' AND newdef !~* '\(sort\)' THEN
          EXECUTE newdef;
        END IF;
      END IF;
    END LOOP;

    EXECUTE format(
      'DROP INDEX IF EXISTS %I.%I',
      sch,
      tbl || '_status_idx'
    );
    IF has_status THEN
      EXECUTE format('ALTER TABLE %I.%I DROP COLUMN IF EXISTS status', sch, tbl);
    END IF;
    EXECUTE format('ALTER TABLE %I.%I DROP COLUMN IF EXISTS sort', sch, tbl);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (is_deleted)',
      left(tbl, 48) || '_is_deleted_idx',
      sch,
      tbl
    );

    IF has_data THEN
      EXECUTE format(
        $q$UPDATE %I.%I
           SET data = data - 'status' - 'sort' - 'is_deleted' - 'is_active'$q$,
        sch, tbl
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.business_records') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.business_records
    ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
  ALTER TABLE public.business_records
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_records'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE public.business_records
      ALTER COLUMN status SET DEFAULT 'published';
    UPDATE public.business_records
    SET is_deleted = true
    WHERE lower(COALESCE(status, '')) = 'archived'
       OR lower(COALESCE(data->>'is_deleted', '')) IN ('true', '1');
  ELSE
    UPDATE public.business_records
    SET is_deleted = true
    WHERE lower(COALESCE(data->>'is_deleted', '')) IN ('true', '1');
  END IF;
  UPDATE public.business_records
  SET is_active = CASE
    WHEN lower(data->>'is_active') IN ('false', '0') THEN false
    WHEN lower(data->>'is_active') IN ('true', '1') THEN true
    ELSE is_active
  END
  WHERE data ? 'is_active';
END $$;

-- ---------------------------------------------------------------------------
-- Layouts: drop retired field references (keep Status on schedule templates)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.helix_strip_retired_fields(node jsonb, keep_status boolean)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  key text;
  val jsonb;
  original jsonb;
  result jsonb;
  elem jsonb;
  built jsonb;
  field_name text;
BEGIN
  IF node IS NULL OR node = 'null'::jsonb THEN
    RETURN 'null'::jsonb;
  END IF;

  IF jsonb_typeof(node) = 'array' THEN
    built := '[]'::jsonb;
    FOR elem IN SELECT value FROM jsonb_array_elements(node)
    LOOP
      IF jsonb_typeof(elem) = 'string' THEN
        field_name := elem #>> '{}';
        IF field_name IN ('sort', '-sort') THEN
          CONTINUE;
        END IF;
        IF NOT keep_status AND field_name IN ('status', '-status') THEN
          CONTINUE;
        END IF;
        built := built || jsonb_build_array(elem);
      ELSE
        elem := public.helix_strip_retired_fields(elem, keep_status);
        IF elem IS NULL THEN
          CONTINUE;
        END IF;
        built := built || jsonb_build_array(elem);
      END IF;
    END LOOP;
    RETURN built;
  END IF;

  IF jsonb_typeof(node) = 'object' THEN
    field_name := COALESCE(node->>'field', node->>'apiName', node->>'api_name');
    IF field_name = 'sort' OR (NOT keep_status AND field_name = 'status') THEN
      RETURN NULL;
    END IF;
    result := '{}'::jsonb;
    FOR key, original IN SELECT j.key, j.value FROM jsonb_each(node) AS j
    LOOP
      val := public.helix_strip_retired_fields(original, keep_status);
      IF val IS NULL THEN
        CONTINUE;
      END IF;
      result := result || jsonb_build_object(key, val);
    END LOOP;
    RETURN result;
  END IF;

  RETURN node;
END;
$$;

UPDATE public.layout_settings
SET payload = public.helix_strip_retired_fields(
      payload,
      entity_api_name = 'crm_schedule_template'
    ),
    updated_at = now()
WHERE payload IS NOT NULL;

UPDATE public.app_presets
SET layout_query = public.helix_strip_retired_fields(
      layout_query,
      collection = 'crm_schedule_template'
    ),
    updated_at = now()
WHERE layout_query IS NOT NULL;

DROP FUNCTION public.helix_strip_retired_fields(jsonb, boolean);
DROP FUNCTION public.helix_ident_ok(text);
