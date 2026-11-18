import {
  readOrgSettingBridge,
  upsertOrgSettingBridge,
} from '@/core/graphql/orgSettingsApi'

export const FAILED_RUN_NOTIFY_SETTING_KEY = 'ops.failed_run_notify'

export interface OrgFailedRunNotifySettings {
  enabled: boolean
}

export function defaultFailedRunNotifySettings(): OrgFailedRunNotifySettings {
  return { enabled: false }
}

export function normalizeFailedRunNotifySettings(
  raw: unknown,
): OrgFailedRunNotifySettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaultFailedRunNotifySettings()
  }
  return { enabled: Boolean((raw as { enabled?: unknown }).enabled) }
}

export async function loadFailedRunNotifySettings(): Promise<OrgFailedRunNotifySettings> {
  const raw = await readOrgSettingBridge(FAILED_RUN_NOTIFY_SETTING_KEY)
  return normalizeFailedRunNotifySettings(raw)
}

export async function saveFailedRunNotifySettings(
  input: OrgFailedRunNotifySettings,
): Promise<OrgFailedRunNotifySettings> {
  const normalized = normalizeFailedRunNotifySettings(input)
  await upsertOrgSettingBridge(FAILED_RUN_NOTIFY_SETTING_KEY, normalized)
  return normalized
}
