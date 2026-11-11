-- CoreEngine platform kernel: physical tables (no domain entities)

-- ---------------------------------------------------------------------------
-- Core registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name text NOT NULL,
  label text NOT NULL,
  icon text,
  singleton boolean NOT NULL DEFAULT false,
  entity_group text,
  display_template text,
  backend_target text NOT NULL DEFAULT 'SUPABASE',
  backend_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  hidden boolean NOT NULL DEFAULT false,
  label_translations jsonb,
  sync_version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entities_api_name_unique UNIQUE (api_name)
);

CREATE INDEX IF NOT EXISTS entities_deleted_at_idx ON public.entities (deleted_at);
CREATE INDEX IF NOT EXISTS entities_backend_target_idx ON public.entities (backend_target);

CREATE TABLE IF NOT EXISTS public.fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.entities (id) ON DELETE CASCADE,
  api_name text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'STRING',
  interface text,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  label_translations jsonb,
  required boolean NOT NULL DEFAULT false,
  readonly boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  is_unique boolean NOT NULL DEFAULT false,
  is_indexed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fields_entity_api_name_unique UNIQUE (entity_id, api_name)
);

CREATE INDEX IF NOT EXISTS fields_entity_id_idx ON public.fields (entity_id);

CREATE TABLE IF NOT EXISTS public.relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.entities (id) ON DELETE CASCADE,
  field_id uuid NOT NULL REFERENCES public.fields (id) ON DELETE CASCADE,
  kind text NOT NULL,
  related_entity_id uuid REFERENCES public.entities (id) ON DELETE SET NULL,
  junction_entity_id uuid REFERENCES public.entities (id) ON DELETE SET NULL,
  allowed_entity_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relations_field_id_unique UNIQUE (field_id)
);

CREATE INDEX IF NOT EXISTS relations_entity_id_idx ON public.relations (entity_id);

-- ---------------------------------------------------------------------------
-- Auth
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  backend_role_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_roles_backend_role_id_uidx
  ON public.app_roles (backend_role_id)
  WHERE backend_role_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid,
  email text,
  first_name text,
  last_name text,
  role_id uuid REFERENCES public.app_roles (id) ON DELETE SET NULL,
  backend_user_id text,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_uidx
  ON public.app_users (lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_backend_user_id_uidx
  ON public.app_users (backend_user_id)
  WHERE backend_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.app_user_credentials (
  user_id uuid PRIMARY KEY REFERENCES public.app_users (id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_refresh_tokens_token_hash_idx
  ON public.app_refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS app_refresh_tokens_user_id_idx
  ON public.app_refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.app_roles (id) ON DELETE CASCADE,
  entity_api_name text NOT NULL,
  can_create boolean NOT NULL DEFAULT false,
  can_read boolean NOT NULL DEFAULT false,
  can_update boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_permissions_role_entity_unique UNIQUE (role_id, entity_api_name)
);

-- ---------------------------------------------------------------------------
-- i18n + layouts (required by /health)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supported_languages (
  code text PRIMARY KEY,
  label text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.translation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  language text NOT NULL,
  value text NOT NULL DEFAULT '',
  namespace text NOT NULL DEFAULT 'crm',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT translation_entries_key_lang_ns_unique UNIQUE (key, language, namespace)
);

CREATE INDEX IF NOT EXISTS translation_entries_language_idx
  ON public.translation_entries (language);

CREATE TABLE IF NOT EXISTS public.layout_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_api_name text NOT NULL,
  group_key text NOT NULL,
  sub_group text,
  role_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS layout_settings_entity_group_idx
  ON public.layout_settings (entity_api_name, group_key);

CREATE TABLE IF NOT EXISTS public.layout_settings_id_map (
  setting_id text PRIMARY KEY,
  layout_setting_id uuid NOT NULL REFERENCES public.layout_settings (id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Sync + auto-number
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.field_auto_number_counters (
  field_id uuid PRIMARY KEY REFERENCES public.fields (id) ON DELETE CASCADE,
  next_value bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.entity_sync_state (
  entity_id uuid PRIMARY KEY REFERENCES public.entities (id) ON DELETE CASCADE,
  last_synced_version integer,
  last_synced_at timestamptz,
  status text,
  last_error text,
  backend_snapshot jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES public.entities (id) ON DELETE SET NULL,
  job_type text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_jobs_created_at_idx ON public.sync_jobs (created_at DESC);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activities (
  id bigserial PRIMARY KEY,
  entity_api_name text NOT NULL,
  record_id text NOT NULL,
  action text NOT NULL,
  user_id text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activities_entity_record_idx
  ON public.activities (entity_api_name, record_id);

CREATE TABLE IF NOT EXISTS public.revisions (
  id bigserial PRIMARY KEY,
  activity_id bigint REFERENCES public.activities (id) ON DELETE SET NULL,
  entity_api_name text NOT NULL,
  record_id text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  parent_revision_id bigint REFERENCES public.revisions (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revisions_entity_record_idx
  ON public.revisions (entity_api_name, record_id);

-- ---------------------------------------------------------------------------
-- Files + user prefs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backend_target text NOT NULL,
  backend_file_id text NOT NULL,
  filename text,
  mime_type text,
  filesize bigint,
  title text,
  uploaded_by uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  parent_collection text,
  parent_record_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT files_backend_unique UNIQUE (backend_target, backend_file_id)
);

CREATE TABLE IF NOT EXISTS public.user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  collection text NOT NULL,
  group_key text NOT NULL,
  setting_key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_unique UNIQUE (user_id, collection, group_key, setting_key)
);

CREATE TABLE IF NOT EXISTS public.recent_record_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  collection text NOT NULL,
  record_id text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recent_record_views_unique UNIQUE (user_id, collection, record_id)
);

-- ---------------------------------------------------------------------------
-- Presets + dashboards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backend_preset_id text NOT NULL UNIQUE,
  collection text,
  bookmark text,
  filter jsonb,
  search text,
  search_query jsonb,
  layout_query jsonb,
  user_id text,
  role_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backend_dashboard_id text NOT NULL UNIQUE,
  name text NOT NULL,
  icon text,
  note text,
  color text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backend_panel_id text NOT NULL UNIQUE,
  dashboard_id text NOT NULL,
  name text,
  icon text,
  color text,
  show_header boolean NOT NULL DEFAULT true,
  note text,
  type text,
  position_x integer NOT NULL DEFAULT 0,
  position_y integer NOT NULL DEFAULT 0,
  width integer NOT NULL DEFAULT 1,
  height integer NOT NULL DEFAULT 1,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Tasks + flows
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_scheduled_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  job_type text NOT NULL,
  cron text NOT NULL DEFAULT '',
  schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone text NOT NULL DEFAULT 'UTC',
  enabled boolean NOT NULL DEFAULT true,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_task_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.app_scheduled_tasks (id) ON DELETE CASCADE,
  status text NOT NULL,
  trigger text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_task_runs_task_id_idx ON public.app_task_runs (task_id);

CREATE TABLE IF NOT EXISTS public.app_flow_triggers (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  handler text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
