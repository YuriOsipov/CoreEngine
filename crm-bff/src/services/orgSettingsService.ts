import { query } from '../db/pool.js'

/**
 * Product org-setting keys (Setup → General / ops toggles). None store
 * credentials — secrets stay in env (`AUTH_*`, `SMTP_*`, `OIDC_*`, n8n) or
 * `app_user_credentials`. Inventory for config-audit `clipJson` previews:
 * - `company_profile` — name, address, locale, currency, date formats, TZ
 * - `files_upload` — allowed image MIME types, max upload MB
 * - `ops.failed_run_notify` — `{ enabled: boolean }`
 * Keep new keys non-secret, or redact before any audit write.
 */
export async function getOrgSetting(settingKey: string): Promise<unknown> {
  const key = String(settingKey || '').trim()
  if (!key) return null
  const rows = await query<{ value: unknown }>(
    `SELECT value
     FROM public.org_settings
     WHERE setting_key = $1
     LIMIT 1`,
    [key],
  )
  if (!rows[0]) return null
  return rows[0].value
}

export async function upsertOrgSetting(
  settingKey: string,
  value: unknown,
): Promise<void> {
  const key = String(settingKey || '').trim()
  if (!key) throw new Error('settingKey is required')
  await query(
    `INSERT INTO public.org_settings (setting_key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (setting_key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = now()`,
    [key, JSON.stringify(value ?? null)],
  )
}
