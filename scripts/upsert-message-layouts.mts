/**
 * Upsert only Message entity/form layouts from the sales pack (does not touch Users).
 * Usage: npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env ./scripts/upsert-message-layouts.mts
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { upsertLayoutSettingRow } from '../crm-bff/src/schema/layoutSettings.ts'
import { pool } from '../crm-bff/src/db/pool.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pack = JSON.parse(
  readFileSync(resolve(repoRoot, 'supabase/domains/sales/layouts.json'), 'utf8'),
) as {
  layouts?: Array<{
    entityApiName: string
    groupKey: string
    subGroup?: string | null
    settingId?: string
    payload?: Record<string, unknown>
  }>
}

const rows = (pack.layouts ?? []).filter(
  (layout) =>
    layout.entityApiName === 'message' &&
    (layout.groupKey === 'entity' || layout.groupKey === 'form'),
)

for (const layout of rows) {
  const payload = (layout.payload ?? {}) as Record<string, unknown>
  const meta = (payload.__meta ?? {}) as Record<string, unknown>
  const settingId =
    String(layout.settingId || meta.settingId || '').trim() || null
  const name =
    (typeof payload.name === 'string' && payload.name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    null
  const { __meta: _drop, ...body } = payload
  await upsertLayoutSettingRow({
    settingId,
    entityApiName: layout.entityApiName,
    groupKey: layout.groupKey,
    subGroup: layout.subGroup ?? null,
    roleId: null,
    name,
    body,
  })
  console.log(`upserted message/${layout.groupKey} ${settingId} ${name}`)
}

await pool.end()
