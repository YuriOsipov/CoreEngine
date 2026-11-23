-- Register user_created / user_updated as Lookup (M2O → users) so reverse
-- related lists (e.g. message_user_created on Users profiles) are discoverable.

INSERT INTO public.relations (
  entity_id,
  field_id,
  kind,
  related_entity_id,
  junction_entity_id,
  meta
)
SELECT
  f.entity_id,
  f.id,
  'M2O',
  u.id,
  NULL,
  jsonb_build_object(
    'one_collection', 'users',
    'on_delete', 'SET NULL'
  )
FROM public.fields f
JOIN public.entities e
  ON e.id = f.entity_id
 AND e.deleted_at IS NULL
JOIN public.entities u
  ON u.api_name = 'users'
 AND u.deleted_at IS NULL
WHERE f.api_name IN ('user_created', 'user_updated')
  AND NOT EXISTS (
    SELECT 1
    FROM public.relations r
    WHERE r.field_id = f.id
  )
ON CONFLICT (field_id) DO NOTHING;

-- Existing relation rows: ensure they point at users with Lookup meta.
UPDATE public.relations r
SET kind = 'M2O',
    related_entity_id = u.id,
    junction_entity_id = NULL,
    meta = COALESCE(r.meta, '{}'::jsonb) || jsonb_build_object(
      'one_collection', 'users',
      'on_delete', COALESCE(r.meta->>'on_delete', 'SET NULL')
    ),
    updated_at = now()
FROM public.fields f
JOIN public.entities u
  ON u.api_name = 'users'
 AND u.deleted_at IS NULL
WHERE r.field_id = f.id
  AND f.api_name IN ('user_created', 'user_updated');
