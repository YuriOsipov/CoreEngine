import { graphqlRequest } from './client'

export interface ConfigAuditDto {
  id: string
  action: string
  resourceType: string
  resourceKey: string
  summary: string
  userId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  createdAt: string
}

export interface ConfigAuditPageDto {
  nodes: ConfigAuditDto[]
  totalCount: number
}

const CONFIG_AUDITS_QUERY = /* GraphQL */ `
  query ConfigAudits(
    $resourceType: String
    $resourceKey: String
    $limit: Int
    $offset: Int
  ) {
    configAudits(
      resourceType: $resourceType
      resourceKey: $resourceKey
      limit: $limit
      offset: $offset
    ) {
      totalCount
      nodes {
        id
        action
        resourceType
        resourceKey
        summary
        userId
        before
        after
        createdAt
      }
    }
  }
`

export async function fetchConfigAudits(options?: {
  resourceType?: string | null
  resourceKey?: string | null
  limit?: number
  offset?: number
}): Promise<ConfigAuditPageDto> {
  const data = await graphqlRequest<{ configAudits: ConfigAuditPageDto }>(
    CONFIG_AUDITS_QUERY,
    {
      resourceType: options?.resourceType?.trim() || null,
      resourceKey: options?.resourceKey?.trim() || null,
      limit: options?.limit ?? 50,
      offset: options?.offset ?? 0,
    },
  )
  return {
    totalCount: Number(data.configAudits?.totalCount || 0),
    nodes: Array.isArray(data.configAudits?.nodes) ? data.configAudits.nodes : [],
  }
}
