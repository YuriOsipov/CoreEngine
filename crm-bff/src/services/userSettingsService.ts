import { randomUUID } from 'node:crypto'
import { query } from '../db/pool.js'

export interface UserSettingRow {
  id: string
  userId: string
  collection: string
  groupKey: string
  key: string
  value: unknown
}

export async function getUserSetting(options: {
  userId: string
  collection: string
  groupKey: string
  key: string
}): Promise<unknown> {
  const rows = await query<{ value: unknown }>(
    `SELECT value
     FROM public.user_settings
     WHERE user_id = $1
       AND collection = $2
       AND group_key = $3
       AND setting_key = $4
     LIMIT 1`,
    [options.userId, options.collection, options.groupKey, options.key],
  )
  if (!rows[0]) return null
  return rows[0].value
}

export async function upsertUserSetting(options: {
  userId: string
  collection: string
  groupKey: string
  key: string
  value: unknown
}): Promise<UserSettingRow> {
  const rows = await query<{
    id: string
    user_id: string
    collection: string
    group_key: string
    setting_key: string
    value: unknown
  }>(
    // Pass id from Node — column default extensions.gen_random_uuid() is WDAC-blocked
    // on some Windows hosts.
    `INSERT INTO public.user_settings (
       id, user_id, collection, group_key, setting_key, value
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (user_id, collection, group_key, setting_key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = now()
     RETURNING id::text AS id, user_id, collection, group_key, setting_key, value`,
    [
      randomUUID(),
      options.userId,
      options.collection,
      options.groupKey,
      options.key,
      JSON.stringify(options.value ?? null),
    ],
  )
  const row = rows[0]
  if (!row) throw new Error('Failed to upsert user setting')
  return {
    id: row.id,
    userId: row.user_id,
    collection: row.collection,
    groupKey: row.group_key,
    key: row.setting_key,
    value: row.value,
  }
}
