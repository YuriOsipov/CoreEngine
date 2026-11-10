import { graphqlRequest } from './client'

export type FlowTriggerHandler = 'http' | 'update_record'

export interface GraphQlFlowTrigger {
  key: string
  handler: FlowTriggerHandler | string
  enabled: boolean
  config: Record<string, unknown>
  description: string | null
  updatedAt: string
}

export interface UpsertFlowTriggerInput {
  key: string
  handler: string
  enabled?: boolean | null
  config?: Record<string, unknown> | null
  description?: string | null
}

const FLOW_FIELDS = `
  key
  handler
  enabled
  config
  description
  updatedAt
`

const LIST_FLOWS = /* GraphQL */ `
  query FlowTriggers {
    flowTriggers {
      ${FLOW_FIELDS}
    }
  }
`

const UPSERT_FLOW = /* GraphQL */ `
  mutation UpsertFlowTrigger($input: UpsertFlowTriggerInput!) {
    upsertFlowTrigger(input: $input) {
      ${FLOW_FIELDS}
    }
  }
`

const DELETE_FLOW = /* GraphQL */ `
  mutation DeleteFlowTrigger($key: String!) {
    deleteFlowTrigger(key: $key)
  }
`

export async function fetchFlowTriggers(): Promise<GraphQlFlowTrigger[]> {
  const data = await graphqlRequest<{ flowTriggers: GraphQlFlowTrigger[] }>(
    LIST_FLOWS,
  )
  return data.flowTriggers ?? []
}

export async function upsertFlowTrigger(
  input: UpsertFlowTriggerInput,
): Promise<GraphQlFlowTrigger> {
  const data = await graphqlRequest<{ upsertFlowTrigger: GraphQlFlowTrigger }>(
    UPSERT_FLOW,
    { input },
  )
  return data.upsertFlowTrigger
}

export async function deleteFlowTrigger(key: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteFlowTrigger: boolean }>(DELETE_FLOW, {
    key,
  })
  return Boolean(data.deleteFlowTrigger)
}
