import { graphqlRequest } from './client'

export type FlowTriggerHandler = 'http'

export interface GraphQlFlowDispatch {
  id: string
  flowKey: string
  source: string
  status: string
  collection: string | null
  recordId: string | null
  error: string | null
  httpStatus: number | null
  requestBody: string | null
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
  lastLaunchedAt: string | null
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
  lastLaunchedAt
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

const DISPATCH_FIELDS = `
  id
  flowKey
  source
  status
  collection
  recordId
  error
  httpStatus
  requestBody
  startedAt
  finishedAt
  createdAt
`

const LIST_FAILED = /* GraphQL */ `
  query FailedFlowDispatches($limit: Int) {
    failedFlowDispatches(limit: $limit) {
      ${DISPATCH_FIELDS}
    }
  }
`

const LIST_DISPATCHES = /* GraphQL */ `
  query FlowDispatches($flowKey: String, $limit: Int) {
    flowDispatches(flowKey: $flowKey, limit: $limit) {
      ${DISPATCH_FIELDS}
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

export async function fetchFlowDispatches(options?: {
  flowKey?: string | null
  limit?: number
}): Promise<GraphQlFlowDispatch[]> {
  const data = await graphqlRequest<{ flowDispatches: GraphQlFlowDispatch[] }>(
    LIST_DISPATCHES,
    {
      flowKey: options?.flowKey ?? null,
      limit: options?.limit ?? 50,
    },
  )
  return data.flowDispatches ?? []
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
