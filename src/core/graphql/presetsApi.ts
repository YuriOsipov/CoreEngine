import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

const PRESETS_QUERY = /* GraphQL */ `
  query Presets(
    $fields: [String!]
    $filter: JSON
    $sort: [String!]
    $limit: Int
  ) {
    presets(fields: $fields, filter: $filter, sort: $sort, limit: $limit)
  }
`

export async function fetchPresetsFromGraphQL(options: {
  fields: string[]
  filter?: Record<string, unknown> | null
  sort?: string[] | null
  limit?: number
}): Promise<Record<string, unknown>[]> {
  const data = await graphqlRequest<{ presets: Record<string, unknown>[] }>(
    PRESETS_QUERY,
    {
      fields: options.fields,
      filter: options.filter ?? null,
      sort: options.sort ?? null,
      limit: options.limit ?? -1,
    },
  )
  return Array.isArray(data.presets) ? data.presets : []
}

export function canUsePresetsGraphQL(): boolean {
  return featureFlags.layoutsFromGraphQL
}

/** List presets — GraphQL only. */
export async function readPresetsBridge(options: {
  fields: string[]
  filter?: Record<string, unknown> | null
  sort?: string[] | null
  limit?: number
}): Promise<Record<string, unknown>[]> {
  if (!canUsePresetsGraphQL()) {
    refuseLegacyFallback('readPresetsBridge')
  }
  return fetchPresetsFromGraphQL(options)
}
