import {
  canUseLayoutSettingsGraphQL,
  clearLayoutSettingsGraphQlCache,
  deleteLayoutSettingFromGraphQL,
  queryLayoutSettings,
  upsertLayoutSettingToGraphQL,
  type LayoutSettingRecordLike,
} from './layoutSettingsApi'
import { refuseLegacyFallback } from './featureFlags'

export type SettingRecordQuery = {
  collection?: string
  groups: string[]
  subGroup?: string | string[]
  roleId?: string | null
  id?: string
  name?: string
  limit?: number
  /** Legacy fields hint — ignored (GraphQL only). */
  fields?: string[]
}

export type SettingWriteInput = {
  /** Existing client-facing setting id (registry key). */
  settingId?: string | null
  entityApiName: string
  groupKey: string
  subGroup?: string | null
  roleId?: string | null
  name?: string | null
  body: Record<string, unknown>
}

/**
 * Setting I/O via BFF GraphQL only. Legacy Setting fallback removed.
 */
export async function readSettingRecords<T extends LayoutSettingRecordLike>(
  options: SettingRecordQuery,
): Promise<T[]> {
  if (!canUseLayoutSettingsGraphQL()) {
    refuseLegacyFallback('readSettingRecords')
  }
  return (await queryLayoutSettings(options)) as T[]
}

export async function readSettingRecord<T extends LayoutSettingRecordLike>(
  options: SettingRecordQuery,
): Promise<T | null> {
  const rows = await readSettingRecords<T>({
    ...options,
    limit: options.limit ?? 1,
  })
  return rows[0] ?? null
}

export async function writeSettingUpsert(input: SettingWriteInput): Promise<string> {
  if (!canUseLayoutSettingsGraphQL()) {
    refuseLegacyFallback('writeSettingUpsert')
  }
  const settingKey = input.settingId?.trim() || crypto.randomUUID()
  await upsertLayoutSettingToGraphQL({
    settingId: settingKey,
    entityApiName: input.entityApiName,
    groupKey: input.groupKey,
    subGroup: input.subGroup ?? null,
    roleId: input.roleId ?? null,
    name: input.name ?? null,
    body: input.body,
  })
  return settingKey
}

export async function writeSettingDelete(settingId: string): Promise<void> {
  if (!canUseLayoutSettingsGraphQL()) {
    refuseLegacyFallback('writeSettingDelete')
  }
  await deleteLayoutSettingFromGraphQL(settingId)
}

export { clearLayoutSettingsGraphQlCache, canUseLayoutSettingsGraphQL }
