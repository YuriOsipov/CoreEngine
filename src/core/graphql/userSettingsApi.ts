import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

const USER_SETTING_QUERY = /* GraphQL */ `
  query UserSetting(
    $userId: ID!
    $collection: String!
    $groupKey: String!
    $key: String!
  ) {
    userSetting(
      userId: $userId
      collection: $collection
      groupKey: $groupKey
      key: $key
    )
  }
`

const UPSERT_USER_SETTING = /* GraphQL */ `
  mutation UpsertUserSetting(
    $userId: ID!
    $collection: String!
    $groupKey: String!
    $key: String!
    $value: JSON
  ) {
    upsertUserSetting(
      userId: $userId
      collection: $collection
      groupKey: $groupKey
      key: $key
      value: $value
    )
  }
`

export async function fetchUserSettingFromGraphQL(options: {
  userId: string
  collection: string
  groupKey: string
  key: string
}): Promise<unknown> {
  const data = await graphqlRequest<{ userSetting: unknown }>(USER_SETTING_QUERY, options)
  return data.userSetting ?? null
}

export async function upsertUserSettingToGraphQL(options: {
  userId: string
  collection: string
  groupKey: string
  key: string
  value: unknown
}): Promise<void> {
  await graphqlRequest(UPSERT_USER_SETTING, options)
}

export function canUseUserSettingsGraphQL(): boolean {
  return featureFlags.layoutsFromGraphQL
}

/** Load one user setting — GraphQL only. */
export async function readUserSettingBridge(options: {
  userId: string
  collection: string
  groupKey: string
  key: string
}): Promise<unknown> {
  if (!canUseUserSettingsGraphQL()) {
    refuseLegacyFallback('readUserSettingBridge')
  }
  return fetchUserSettingFromGraphQL(options)
}

/** Upsert one user setting — GraphQL only. */
export async function upsertUserSettingBridge(options: {
  userId: string
  collection: string
  groupKey: string
  key: string
  value: unknown
}): Promise<void> {
  if (!canUseUserSettingsGraphQL()) {
    refuseLegacyFallback('upsertUserSettingBridge')
  }
  await upsertUserSettingToGraphQL(options)
}
