-- Promote 1-field backend_config.uniqueGroups onto fields.is_unique, then keep
-- only composite groups (2+ fields) in uniqueGroups. Single-field uniqueness
-- belongs on fields.is_unique (Setup → Single-field unique).

UPDATE public.fields f
SET is_unique = true,
    updated_at = now()
FROM public.entities e
WHERE f.entity_id = e.id
  AND e.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(e.backend_config->'uniqueGroups', '[]'::jsonb)) g
    WHERE jsonb_typeof(g->'fields') = 'array'
      AND jsonb_array_length(g->'fields') = 1
      AND g->'fields'->>0 = f.api_name
  );

UPDATE public.entities e
SET backend_config = jsonb_set(
  COALESCE(e.backend_config, '{}'::jsonb),
  '{uniqueGroups}',
  COALESCE((
    SELECT jsonb_agg(g ORDER BY ordinality)
    FROM jsonb_array_elements(COALESCE(e.backend_config->'uniqueGroups', '[]'::jsonb))
      WITH ORDINALITY AS t(g, ordinality)
    WHERE jsonb_typeof(g->'fields') = 'array'
      AND jsonb_array_length(g->'fields') >= 2
  ), '[]'::jsonb),
  true
),
updated_at = now()
WHERE e.deleted_at IS NULL
  AND e.backend_config ? 'uniqueGroups'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(e.backend_config->'uniqueGroups', '[]'::jsonb)) g
    WHERE jsonb_typeof(g->'fields') <> 'array'
       OR jsonb_array_length(g->'fields') < 2
  );
