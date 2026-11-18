import { graphqlRequest } from './client'

export type FlowTriggerHandler = 'http' | 'update_record'

export interface GraphQlFlowDispatch {
  id: string
  flowKey: string
  source: string
  status: string
  collection: string | null
  recordId: string | null
  error: string | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

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

const LIST_FAILED = /* GraphQL */ `
  query FailedFlowDispatches($limit: Int) {
    failedFlowDispatches(limit: $limit) {
      id
      flowKey
      source
      status
      collection
      recordId
      error
      startedAt
      finishedAt
      createdAt
    }
  }
`

const DELETE_FLOW = /* GraphQL */ `
  mutation DeleteFlowTrigger($key: String!) {
    deleteFlowTrigger(key: $key)
  }
`

export async function fetchFailedFlowDispatches(
  limit = 50,
): Promise<GraphQlFlowDispatch[]> {
  const data = await graphqlRequest<{ failedFlowDispatches: GraphQlFlowDispatch[] }>(
    LIST_FAILED,
    { limit },
  )
  return data.failedFlowDispatches ?? []
}

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
