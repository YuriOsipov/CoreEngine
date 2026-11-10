-- CoreEngine platform kernel seed: admin + reserved PLATFORM objects + default language.
-- Password is set by provision script (registry:set-user-password), not here.

INSERT INTO public.supported_languages (code, label, is_default, is_active, sort)
VALUES ('en-US', 'English (US)', true, true, 0)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  is_default = EXCLUDED.is_default,
  is_active = EXCLUDED.is_active,
  sort = EXCLUDED.sort;

-- Fixed UUIDs so docs/scripts can refer to them stably across customer DBs.
INSERT INTO public.app_roles (id, name, is_admin, backend_role_id)
VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'Administrator',
  true,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  is_admin = EXCLUDED.is_admin,
  backend_role_id = EXCLUDED.backend_role_id,
  updated_at = now();

INSERT INTO public.app_users (
  id, auth_user_id, email, first_name, last_name, role_id, backend_user_id, is_active
) VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  NULL,
  'admin@example.com',
  'Platform',
  'Admin',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  true
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  role_id = EXCLUDED.role_id,
  backend_user_id = EXCLUDED.backend_user_id,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- Reserved / PLATFORM registry shells (no crm_schema DDL).
INSERT INTO public.entities (
  id, api_name, label, icon, singleton, entity_group, display_template,
  backend_target, backend_config, hidden
) VALUES
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccc0001'::uuid,
    'Setting',
    'Settings',
    'settings',
    true,
    'Platform',
    '{{name}}',
    'PLATFORM',
    '{"internal":true}'::jsonb,
    true
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccc0002'::uuid,
    'user_setting',
    'User settings',
    'person',
    false,
    'Platform',
    '{{name}}',
    'PLATFORM',
    '{"internal":true}'::jsonb,
    true
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccc0003'::uuid,
    'recent_record_views',
    'Recent record views',
    'history',
    false,
    'Platform',
    '{{name}}',
    'PLATFORM',
    '{"internal":true}'::jsonb,
    true
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccc0004'::uuid,
    'files',
    'Files',
    'folder',
    false,
    'Platform',
    '{{filename}}',
    'PLATFORM',
    '{"internal":true}'::jsonb,
    false
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccc0005'::uuid,
    'users',
    'Users',
    'people',
    false,
    'Platform',
    '{{email}}',
    'PLATFORM',
    '{"internal":true}'::jsonb,
    false
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccc0006'::uuid,
    'roles',
    'Roles',
    'verified_user',
    false,
    'Platform',
    '{{name}}',
    'PLATFORM',
    '{"internal":true}'::jsonb,
    false
  )
ON CONFLICT (api_name) DO UPDATE SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  singleton = EXCLUDED.singleton,
  entity_group = EXCLUDED.entity_group,
  display_template = EXCLUDED.display_template,
  backend_target = EXCLUDED.backend_target,
  backend_config = EXCLUDED.backend_config,
  hidden = EXCLUDED.hidden,
  updated_at = now(),
  deleted_at = NULL;
