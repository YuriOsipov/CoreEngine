import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'
import type { UpsertDashboardInput, UpsertPanelInput } from '@/interfaces'

const DASHBOARDS_QUERY = /* GraphQL */ `
  query Dashboards($fields: [String!], $sort: [String!], $limit: Int) {
    dashboards(fields: $fields, sort: $sort, limit: $limit)
  }
`

const PANELS_QUERY = /* GraphQL */ `
  query Panels(
    $fields: [String!]
    $filter: JSON
    $sort: [String!]
    $limit: Int
  ) {
    panels(fields: $fields, filter: $filter, sort: $sort, limit: $limit)
  }
`

const AGGREGATE_RECORDS_QUERY = /* GraphQL */ `
  query AggregateRecords(
    $entity: String!
    $aggregate: JSON!
    $groupBy: [String!]
    $filter: JSON
    $limit: Int
  ) {
    aggregateRecords(
      entity: $entity
      aggregate: $aggregate
      groupBy: $groupBy
      filter: $filter
      limit: $limit
    )
  }
`

const UPSERT_DASHBOARD_MUTATION = /* GraphQL */ `
  mutation UpsertDashboard($input: UpsertDashboardInput!) {
    upsertDashboard(input: $input) {
      id
      name
      icon
      note
      color
      roleId
      sourceSnapshot
      lastRefreshedAt
    }
  }
`

const DELETE_DASHBOARD_MUTATION = /* GraphQL */ `
  mutation DeleteDashboard($id: ID!) {
    deleteDashboard(id: $id)
  }
`

const UPSERT_PANEL_MUTATION = /* GraphQL */ `
  mutation UpsertPanel($input: UpsertPanelInput!) {
    upsertPanel(input: $input) {
      id
      dashboard
      name
      icon
      color
      show_header
      note
      type
      position_x
      position_y
      width
      height
      options
    }
  }
`

const DELETE_PANEL_MUTATION = /* GraphQL */ `
  mutation DeletePanel($id: ID!) {
    deletePanel(id: $id)
  }
`

export async function fetchDashboardsFromGraphQL(options: {
  fields?: string[]
  sort?: string[]
  limit?: number
} = {}): Promise<Record<string, unknown>[]> {
  const data = await graphqlRequest<{ dashboards: Record<string, unknown>[] }>(
    DASHBOARDS_QUERY,
    {
      fields: options.fields ?? null,
      sort: options.sort ?? null,
      limit: options.limit ?? -1,
    },
  )
  return Array.isArray(data.dashboards) ? data.dashboards : []
}

export async function fetchPanelsFromGraphQL(options: {
  fields?: string[]
  filter?: Record<string, unknown> | null
  sort?: string[]
  limit?: number
} = {}): Promise<Record<string, unknown>[]> {
  const data = await graphqlRequest<{ panels: Record<string, unknown>[] }>(
    PANELS_QUERY,
    {
      fields: options.fields ?? null,
      filter: options.filter ?? null,
      sort: options.sort ?? null,
      limit: options.limit ?? -1,
    },
  )
  return Array.isArray(data.panels) ? data.panels : []
}

export async function fetchAggregateRecordsFromGraphQL(options: {
  entity: string
  aggregate: Record<string, unknown>
  groupBy?: string[]
  filter?: Record<string, unknown> | null
  limit?: number
}): Promise<Record<string, unknown>[]> {
  const data = await graphqlRequest<{ aggregateRecords: Record<string, unknown>[] }>(
    AGGREGATE_RECORDS_QUERY,
    {
      entity: options.entity,
      aggregate: options.aggregate,
      groupBy: options.groupBy ?? null,
      filter: options.filter ?? null,
      limit: options.limit ?? -1,
    },
  )
  return Array.isArray(data.aggregateRecords) ? data.aggregateRecords : []
}

export async function upsertDashboardToGraphQL(
  input: UpsertDashboardInput,
): Promise<Record<string, unknown>> {
  const data = await graphqlRequest<{ upsertDashboard: Record<string, unknown> }>(
    UPSERT_DASHBOARD_MUTATION,
    { input },
  )
  return data.upsertDashboard
}

export async function deleteDashboardFromGraphQL(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deleteDashboard: boolean }>(
    DELETE_DASHBOARD_MUTATION,
    { id },
  )
  return Boolean(data.deleteDashboard)
}

export async function upsertPanelToGraphQL(
  input: UpsertPanelInput,
): Promise<Record<string, unknown>> {
  const data = await graphqlRequest<{ upsertPanel: Record<string, unknown> }>(
    UPSERT_PANEL_MUTATION,
    { input },
  )
  return data.upsertPanel
}

export async function deletePanelFromGraphQL(id: string): Promise<boolean> {
  const data = await graphqlRequest<{ deletePanel: boolean }>(
    DELETE_PANEL_MUTATION,
    { id },
  )
  return Boolean(data.deletePanel)
}

export function canUseDashboardsGraphQL(): boolean {
  return featureFlags.layoutsFromGraphQL
}

export function canUseAggregateGraphQL(): boolean {
  return featureFlags.recordsFromGraphQL
}

/** List dashboards — GraphQL only. */
export async function readDashboardsBridge(options: {
  fields?: string[]
  sort?: string[]
  limit?: number
} = {}): Promise<Record<string, unknown>[]> {
  if (!canUseDashboardsGraphQL()) {
    refuseLegacyFallback('readDashboardsBridge')
  }
  return fetchDashboardsFromGraphQL(options)
}

/** List panels — GraphQL only. */
export async function readPanelsBridge(options: {
  fields?: string[]
  filter?: Record<string, unknown> | null
  sort?: string[]
  limit?: number
} = {}): Promise<Record<string, unknown>[]> {
  if (!canUseDashboardsGraphQL()) {
    refuseLegacyFallback('readPanelsBridge')
  }
  return fetchPanelsFromGraphQL(options)
}

/** Aggregate records for dashboard panels — GraphQL only. */
export async function readAggregateRecordsBridge(options: {
  entity: string
  aggregate: Record<string, unknown>
  groupBy?: string[]
  filter?: Record<string, unknown> | null
  limit?: number
}): Promise<Record<string, unknown>[]> {
  if (!canUseAggregateGraphQL()) {
    refuseLegacyFallback('readAggregateRecordsBridge')
  }
  return fetchAggregateRecordsFromGraphQL(options)
}

/** Upsert dashboard — GraphQL only. */
export async function upsertDashboardBridge(
  input: UpsertDashboardInput,
): Promise<Record<string, unknown>> {
  if (!canUseDashboardsGraphQL()) {
    refuseLegacyFallback('upsertDashboardBridge')
  }
  return upsertDashboardToGraphQL(input)
}

/** Delete dashboard — GraphQL only. */
export async function deleteDashboardBridge(id: string): Promise<boolean> {
  if (!canUseDashboardsGraphQL()) {
    refuseLegacyFallback('deleteDashboardBridge')
  }
  return deleteDashboardFromGraphQL(id)
}

/** Upsert panel — GraphQL only. */
export async function upsertPanelBridge(
  input: UpsertPanelInput,
): Promise<Record<string, unknown>> {
  if (!canUseDashboardsGraphQL()) {
    refuseLegacyFallback('upsertPanelBridge')
  }
  return upsertPanelToGraphQL(input)
}

/** Delete panel — GraphQL only. */
export async function deletePanelBridge(id: string): Promise<boolean> {
  if (!canUseDashboardsGraphQL()) {
    refuseLegacyFallback('deletePanelBridge')
  }
  return deletePanelFromGraphQL(id)
}
