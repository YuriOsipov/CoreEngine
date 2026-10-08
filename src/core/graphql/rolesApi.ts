import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'
import type { AppRoleOption } from '@/interfaces'

const ROLES_QUERY = /* GraphQL */ `
  query Roles {
    roles {
      id
      name
    }
  }
`

export async function fetchRolesFromGraphQL(): Promise<AppRoleOption[]> {
  const data = await graphqlRequest<{ roles: AppRoleOption[] }>(ROLES_QUERY)
  return Array.isArray(data.roles) ? data.roles : []
}

export function canUseRolesGraphQL(): boolean {
  return featureFlags.layoutsFromGraphQL
}

/** App roles — GraphQL (`app_roles`) only. */
export async function readRolesBridge(): Promise<AppRoleOption[]> {
  if (!canUseRolesGraphQL()) {
    refuseLegacyFallback('readRolesBridge')
  }
  return fetchRolesFromGraphQL()
}
