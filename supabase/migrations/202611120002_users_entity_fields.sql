-- Seed registry fields + default Block/Compact layouts for PLATFORM `users`.
-- Role / is_active stay system+hidden (Setup → Users only; not Block Layout palette).

-- ---------------------------------------------------------------------------
-- Registry fields
-- ---------------------------------------------------------------------------
INSERT INTO public.fields (
  id, entity_id, api_name, label, field_type, interface,
  options, display_options, required, readonly, hidden, sort,
  is_system, is_unique, is_indexed, sensitivity
)
VALUES
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddd0001'::uuid,
    'cccccccc-cccc-4ccc-8ccc-cccccccc0005'::uuid,
    'first_name',
    'First Name',
    'STRING',
    'input',
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    false,
    false,
    10,
    true,
    false,
    false,
    0
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddd0002'::uuid,
    'cccccccc-cccc-4ccc-8ccc-cccccccc0005'::uuid,
    'last_name',
    'Last Name',
    'STRING',
    'input',
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    false,
    false,
    20,
    true,
    false,
    false,
    0
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddd0003'::uuid,
    'cccccccc-cccc-4ccc-8ccc-cccccccc0005'::uuid,
    'email',
    'Email',
    'STRING',
    'input',
    '{}'::jsonb,
    '{}'::jsonb,
    true,
    false,
    false,
    30,
    true,
    true,
    true,
    0
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddd0004'::uuid,
    'cccccccc-cccc-4ccc-8ccc-cccccccc0005'::uuid,
    'role_id',
    'Role',
    'UUID',
    'select-dropdown-m2o',
    '{}'::jsonb,
    '{}'::jsonb,
    false,
    false,
    true,
    40,
    true,
    false,
    true,
    0
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddd0005'::uuid,
    'cccccccc-cccc-4ccc-8ccc-cccccccc0005'::uuid,
    'is_active',
    'Is Active',
    'BOOLEAN',
    'boolean',
    '{"default": true}'::jsonb,
    '{}'::jsonb,
    false,
    false,
    true,
    50,
    true,
    false,
    false,
    0
  )
ON CONFLICT (entity_id, api_name) DO UPDATE SET
  label = EXCLUDED.label,
  field_type = EXCLUDED.field_type,
  interface = EXCLUDED.interface,
  options = EXCLUDED.options,
  required = EXCLUDED.required,
  readonly = EXCLUDED.readonly,
  hidden = EXCLUDED.hidden,
  sort = EXCLUDED.sort,
  is_system = EXCLUDED.is_system,
  is_unique = EXCLUDED.is_unique,
  is_indexed = EXCLUDED.is_indexed,
  updated_at = now();

-- role_id → roles (metadata only; physical FK already on app_users.role_id → app_roles)
INSERT INTO public.relations (
  id, entity_id, field_id, kind, related_entity_id, meta
)
VALUES (
  'dddddddd-dddd-4ddd-8ddd-dddddddd0010'::uuid,
  'cccccccc-cccc-4ccc-8ccc-cccccccc0005'::uuid,
  'dddddddd-dddd-4ddd-8ddd-dddddddd0004'::uuid,
  'M2O',
  'cccccccc-cccc-4ccc-8ccc-cccccccc0006'::uuid,
  '{"one_collection":"roles"}'::jsonb
)
ON CONFLICT (field_id) DO UPDATE SET
  kind = EXCLUDED.kind,
  related_entity_id = EXCLUDED.related_entity_id,
  meta = EXCLUDED.meta,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Default Block Layout (entity / full)
-- ---------------------------------------------------------------------------
INSERT INTO public.layout_settings (
  id, entity_api_name, group_key, sub_group, role_id, payload
)
VALUES (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'::uuid,
  'users',
  'entity',
  'full',
  NULL,
  jsonb_build_object(
    'name', 'Users',
    'entity', 'users',
    'version', 1,
    'actions', '[]'::jsonb,
    'systemInfo', jsonb_build_object('enabled', true, 'collapsed', false),
    'sections', jsonb_build_array(
      jsonb_build_object(
        'id', 'main',
        'title', 'Users',
        'columns', 12,
        'groups', jsonb_build_array(
          jsonb_build_object(
            'id', 'group_general',
            'title', 'General',
            'collapsed', false,
            'inlineLabels', true,
            'fields', jsonb_build_array(
              jsonb_build_object(
                'id', 'field_first_name',
                'field', 'first_name',
                'label', 'First Name',
                'component', 'InputText',
                'span', 6
              ),
              jsonb_build_object(
                'id', 'field_last_name',
                'field', 'last_name',
                'label', 'Last Name',
                'component', 'InputText',
                'span', 6
              ),
              jsonb_build_object(
                'id', 'field_email',
                'field', 'email',
                'label', 'Email',
                'component', 'InputText',
                'span', 12
              )
            )
          )
        )
      )
    ),
    '__meta', jsonb_build_object(
      'settingId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001',
      'role', NULL,
      'name', 'Users',
      'status', 'published'
    )
  )
)
ON CONFLICT (id) DO UPDATE SET
  entity_api_name = EXCLUDED.entity_api_name,
  group_key = EXCLUDED.group_key,
  sub_group = EXCLUDED.sub_group,
  role_id = EXCLUDED.role_id,
  payload = EXCLUDED.payload,
  updated_at = now();

INSERT INTO public.layout_settings_id_map (setting_id, layout_setting_id)
VALUES (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0001'::uuid
)
ON CONFLICT (setting_id) DO UPDATE SET
  layout_setting_id = EXCLUDED.layout_setting_id;

-- ---------------------------------------------------------------------------
-- Default Compact layout (entity / compact)
-- ---------------------------------------------------------------------------
INSERT INTO public.layout_settings (
  id, entity_api_name, group_key, sub_group, role_id, payload
)
VALUES (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002'::uuid,
  'users',
  'entity',
  'compact',
  NULL,
  jsonb_build_object(
    'name', 'Users',
    'entity', 'users',
    'version', 1,
    'actions', '[]'::jsonb,
    'fields', jsonb_build_array(
      jsonb_build_object(
        'id', 'field_first_name',
        'field', 'first_name',
        'label', 'First Name',
        'component', 'InputText'
      ),
      jsonb_build_object(
        'id', 'field_last_name',
        'field', 'last_name',
        'label', 'Last Name',
        'component', 'InputText'
      ),
      jsonb_build_object(
        'id', 'field_email',
        'field', 'email',
        'label', 'Email',
        'component', 'InputText'
      )
    ),
    'relatedCounts', '[]'::jsonb,
    'sections', jsonb_build_array(
      jsonb_build_object(
        'id', 'main',
        'title', 'Users',
        'columns', 12,
        'groups', jsonb_build_array(
          jsonb_build_object(
            'id', 'group_general',
            'title', 'General',
            'collapsed', false,
            'inlineLabels', true,
            'fields', jsonb_build_array(
              jsonb_build_object(
                'id', 'field_first_name',
                'field', 'first_name',
                'label', 'First Name',
                'component', 'InputText'
              ),
              jsonb_build_object(
                'id', 'field_last_name',
                'field', 'last_name',
                'label', 'Last Name',
                'component', 'InputText'
              ),
              jsonb_build_object(
                'id', 'field_email',
                'field', 'email',
                'label', 'Email',
                'component', 'InputText'
              )
            )
          )
        )
      )
    ),
    '__meta', jsonb_build_object(
      'settingId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002',
      'role', NULL,
      'name', 'Users',
      'status', 'published'
    )
  )
)
ON CONFLICT (id) DO UPDATE SET
  entity_api_name = EXCLUDED.entity_api_name,
  group_key = EXCLUDED.group_key,
  sub_group = EXCLUDED.sub_group,
  role_id = EXCLUDED.role_id,
  payload = EXCLUDED.payload,
  updated_at = now();

INSERT INTO public.layout_settings_id_map (setting_id, layout_setting_id)
VALUES (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeee0002'::uuid
)
ON CONFLICT (setting_id) DO UPDATE SET
  layout_setting_id = EXCLUDED.layout_setting_id;
