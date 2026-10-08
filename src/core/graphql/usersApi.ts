import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

const USERS_QUERY = /* GraphQL */ `
  query Users(
    $ids: [ID!]
    $search: String
    $fields: [String!]
    $limit: Int
    $sort: [String!]
  ) {
    users(
      ids: $ids
      search: $search
      fields: $fields
      limit: $limit
      sort: $sort
    )
  }
`

export async function fetchUsersFromGraphQL(options: {
  ids?: string[]
  search?: string | null
  fields?: string[]
  limit?: number
  sort?: string[]
}): Promise<Record<string, unknown>[]> {
  const ids = options.ids?.map(String).filter(Boolean)
  const data = await graphqlRequest<{ users: Record<string, unknown>[] }>(
    USERS_QUERY,
    {
      ids: ids?.length ? [...new Set(ids)] : null,
      search: options.search ?? null,
      fields: options.fields ?? ['id', 'first_name', 'last_name', 'email'],
      limit: options.limit ?? null,
      sort: options.sort ?? null,
    },
  )
  return Array.isArray(data.users) ? data.users : []
}

/** @deprecated Prefer fetchUsersFromGraphQL({ ids }) */
export async function fetchUsersByIdsFromGraphQL(
  ids: string[],
  fields?: string[],
): Promise<Record<string, unknown>[]> {
  return fetchUsersFromGraphQL({ ids, fields, limit: ids.length })
}

export function canUseUsersGraphQL(): boolean {
  return featureFlags.auditFromGraphQL || featureFlags.recordsFromGraphQL
}

/** List users — GraphQL only. */
export async function readUsersBridge(options: {
  ids?: string[]
  search?: string | null
  fields?: string[]
  limit?: number
  sort?: string[]
  /** @deprecated Ignored — legacy filter path removed. */
  filter?: Record<string, unknown>
}): Promise<Record<string, unknown>[]> {
  if (!canUseUsersGraphQL()) {
    refuseLegacyFallback('readUsersBridge')
  }
  return fetchUsersFromGraphQL(options)
}
