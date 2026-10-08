import { query } from '../db/pool.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type LayoutSettingRow = {
  id: string
  entityApiName: string
  groupKey: string
  subGroup: string | null
  roleId: string | null
  payload: Record<string, unknown>
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function toGraphQlRow(row: {
  id: string
  entity_api_name: string
  group_key: string
  sub_group: string | null
  role_id: string | null
  payload: unknown
}): LayoutSettingRow {
  return {
    id: String(row.id),
    entityApiName: String(row.entity_api_name),
    groupKey: String(row.group_key),
    subGroup: row.sub_group == null ? null : String(row.sub_group),
    roleId: row.role_id == null ? null : String(row.role_id),
    payload:
      row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
  }
}

async function ensureIdMapTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS public.layout_settings_id_map (
      setting_id text PRIMARY KEY,
      layout_setting_id uuid NOT NULL REFERENCES public.layout_settings(id) ON DELETE CASCADE
    );
  `)
}

async function rememberSettingMap(
  settingKey: string | null,
  layoutId: string,
): Promise<void> {
  if (!settingKey) return
  await query(
    `INSERT INTO public.layout_settings_id_map (setting_id, layout_setting_id)
     VALUES ($1, $2::uuid)
     ON CONFLICT (setting_id) DO UPDATE
       SET layout_setting_id = EXCLUDED.layout_setting_id`,
    [settingKey, layoutId],
  )
}

async function resolveExistingLayoutId(settingKey: string | null): Promise<string | null> {
  if (!settingKey) return null

  const mapped = await query<{ layout_setting_id: string }>(
    `SELECT m.layout_setting_id::text AS layout_setting_id
     FROM public.layout_settings_id_map m
     JOIN public.layout_settings ls ON ls.id = m.layout_setting_id
     WHERE m.setting_id = $1
     LIMIT 1`,
    [settingKey],
  )
  if (mapped[0]?.layout_setting_id) return mapped[0].layout_setting_id

  if (isUuid(settingKey)) {
    const byId = await query<{ id: string }>(
      `SELECT id::text AS id
       FROM public.layout_settings
       WHERE id = $1::uuid
       LIMIT 1`,
      [settingKey],
    )
    if (byId[0]?.id) return byId[0].id
  }

  const byMeta = await query<{ id: string }>(
    `SELECT id::text AS id
     FROM public.layout_settings
     WHERE payload->'__meta'->>'settingId' = $1
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [settingKey],
  )
  return byMeta[0]?.id ?? null
}

export async function upsertLayoutSettingRow(input: {
  settingId?: string | null
  entityApiName: string
  groupKey: string
  subGroup?: string | null
  roleId?: string | null
  name?: string | null
  body: Record<string, unknown>
}): Promise<LayoutSettingRow> {
  await ensureIdMapTable()

  const settingKey = input.settingId?.trim() || null
  const existingId = await resolveExistingLayoutId(settingKey)
  const payload = {
    name: input.name ?? null,
    ...(input.body ?? {}),
    __meta: {
      settingId: settingKey ?? existingId,
      role: input.roleId ?? null,
      name: input.name ?? null,
      status: 'published',
    },
  }

  if (existingId) {
    const updated = await query<{
      id: string
      entity_api_name: string
      group_key: string
      sub_group: string | null
      role_id: string | null
      payload: unknown
    }>(
      `UPDATE public.layout_settings
       SET entity_api_name = $2,
           group_key = $3,
           sub_group = $4,
           role_id = NULL,
           payload = $5::jsonb,
           updated_at = now()
       WHERE id = $1::uuid
       RETURNING id::text AS id, entity_api_name, group_key, sub_group, role_id, payload`,
      [
        existingId,
        input.entityApiName,
        input.groupKey,
        input.subGroup ?? null,
        JSON.stringify({
          ...payload,
          __meta: {
            ...payload.__meta,
            settingId: settingKey ?? existingId,
          },
        }),
      ],
    )
    const row = updated[0]
    if (!row) throw new Error(`Layout setting disappeared: ${existingId}`)
    await rememberSettingMap(settingKey ?? existingId, row.id)
    return toGraphQlRow(row)
  }

  const insertId = settingKey && isUuid(settingKey) ? settingKey : null
  const insertPayload = {
    ...payload,
    __meta: {
      ...payload.__meta,
      settingId: insertId ?? settingKey,
    },
  }
  const inserted = await query<{
    id: string
    entity_api_name: string
    group_key: string
    sub_group: string | null
    role_id: string | null
    payload: unknown
  }>(
    `INSERT INTO public.layout_settings (
       id, entity_api_name, group_key, sub_group, role_id, payload
     ) VALUES (
       COALESCE($5::uuid, gen_random_uuid()), $1, $2, $3, NULL, $4::jsonb
     )
     RETURNING id::text AS id, entity_api_name, group_key, sub_group, role_id, payload`,
    [
      input.entityApiName,
      input.groupKey,
      input.subGroup ?? null,
      JSON.stringify(insertPayload),
      insertId,
    ],
  )
  const row = inserted[0]
  if (!row) throw new Error('Failed to create layout setting')
  const resolvedKey = settingKey ?? row.id
  if (insertPayload.__meta.settingId !== resolvedKey) {
    const nextPayload = {
      ...insertPayload,
      __meta: { ...insertPayload.__meta, settingId: resolvedKey },
    }
    await query(
      `UPDATE public.layout_settings
       SET payload = $2::jsonb
       WHERE id = $1::uuid`,
      [row.id, JSON.stringify(nextPayload)],
    )
    row.payload = nextPayload
  }
  await rememberSettingMap(resolvedKey, row.id)
  return toGraphQlRow(row)
}
