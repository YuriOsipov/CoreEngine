import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

const ORG_SETTING_QUERY = /* GraphQL */ `
  query OrgSetting($key: String!) {
    orgSetting(key: $key)
  }
`

const UPSERT_ORG_SETTING = /* GraphQL */ `
  mutation UpsertOrgSetting($key: String!, $value: JSON) {
    upsertOrgSetting(key: $key, value: $value)
  }
`

export async function fetchOrgSettingFromGraphQL(key: string): Promise<unknown> {
  const data = await graphqlRequest<{ orgSetting: unknown }>(ORG_SETTING_QUERY, {
    key,
  })
  return data.orgSetting ?? null
}

export async function upsertOrgSettingToGraphQL(
  key: string,
  value: unknown,
): Promise<void> {
  await graphqlRequest(UPSERT_ORG_SETTING, { key, value })
}

export function canUseOrgSettingsGraphQL(): boolean {
  return featureFlags.layoutsFromGraphQL
}

export async function readOrgSettingBridge(key: string): Promise<unknown> {
  if (!canUseOrgSettingsGraphQL()) {
    refuseLegacyFallback('readOrgSettingBridge')
  }
  return fetchOrgSettingFromGraphQL(key)
}

export async function upsertOrgSettingBridge(
  key: string,
  value: unknown,
): Promise<void> {
  if (!canUseOrgSettingsGraphQL()) {
    refuseLegacyFallback('upsertOrgSettingBridge')
  }
  await upsertOrgSettingToGraphQL(key, value)
}
