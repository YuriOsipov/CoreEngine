import { graphqlRequest } from './client'
import { featureFlags } from './featureFlags'
import { consumeAutomationToastsFromRecord } from '@/core/automationToasts'

const RECORD_QUERY = /* GraphQL */ `
  query Record($entity: String!, $id: ID!, $fields: [String!]) {
    record(entity: $entity, id: $id, fields: $fields)
  }
`

const RECORDS_QUERY = /* GraphQL */ `
  query Records(
    $entity: String!
    $filter: JSON
    $fields: [String!]
    $sort: [String!]
    $search: String
    $limit: Int
    $offset: Int
    $includeDeleted: Boolean
  ) {
    records(
      entity: $entity
      filter: $filter
      fields: $fields
      sort: $sort
      search: $search
      limit: $limit
      offset: $offset
      includeDeleted: $includeDeleted
    ) {
      nodes
      totalCount
    }
  }
`

const CREATE_RECORD = /* GraphQL */ `
  mutation CreateRecord($entity: String!, $data: JSON!, $fields: [String!]) {
    createRecord(entity: $entity, data: $data, fields: $fields)
  }
`

const UPDATE_RECORD = /* GraphQL */ `
  mutation UpdateRecord(
    $entity: String!
    $id: ID!
    $data: JSON!
    $fields: [String!]
  ) {
    updateRecord(entity: $entity, id: $id, data: $data, fields: $fields)
  }
`

const SOFT_DELETE_RECORD = /* GraphQL */ `
  mutation SoftDeleteRecord($entity: String!, $id: ID!) {
    softDeleteRecord(entity: $entity, id: $id)
  }
`

const DELETE_RECORD = /* GraphQL */ `
  mutation DeleteRecord($entity: String!, $id: ID!) {
    deleteRecord(entity: $entity, id: $id)
  }
`

const RESTORE_RECORD = /* GraphQL */ `
  mutation RestoreRecord($entity: String!, $id: ID!) {
    restoreRecord(entity: $entity, id: $id)
  }
`

export async function fetchRecordFromGraphQL(
  entity: string,
  id: string,
  fields?: string[],
): Promise<Record<string, unknown>> {
  const data = await graphqlRequest<{ record: Record<string, unknown> }>(
    RECORD_QUERY,
    { entity, id, fields: fields ?? null },
  )
  return data.record
}

export async function fetchRecordsFromGraphQL(options: {
  entity: string
  filter?: Record<string, unknown> | null
  fields?: string[]
  sort?: string[]
  search?: string
  limit?: number
  offset?: number
  includeDeleted?: boolean
}): Promise<{ nodes: Record<string, unknown>[]; totalCount: number }> {
  const data = await graphqlRequest<{
    records: { nodes: Record<string, unknown>[]; totalCount: number }
  }>(RECORDS_QUERY, {
    entity: options.entity,
    filter: options.filter ?? null,
    fields: options.fields ?? null,
    sort: options.sort ?? null,
    search: options.search ?? null,
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    includeDeleted: options.includeDeleted ?? false,
  })
  return data.records
}

export async function createRecordViaGraphQL(
  entity: string,
  payload: Record<string, unknown>,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const data = await graphqlRequest<{ createRecord: Record<string, unknown> }>(
    CREATE_RECORD,
    { entity, data: payload, fields: fields ?? null },
  )
  return consumeAutomationToastsFromRecord(data.createRecord)
}

export async function updateRecordViaGraphQL(
  entity: string,
  id: string,
  payload: Record<string, unknown>,
  fields?: string[] | null,
): Promise<Record<string, unknown>> {
  const data = await graphqlRequest<{ updateRecord: Record<string, unknown> }>(
    UPDATE_RECORD,
    { entity, id, data: payload, fields: fields ?? null },
  )
  return consumeAutomationToastsFromRecord(data.updateRecord)
}

export async function softDeleteRecordViaGraphQL(
  entity: string,
  id: string,
): Promise<Record<string, unknown>> {
  const data = await graphqlRequest<{ softDeleteRecord: Record<string, unknown> }>(
    SOFT_DELETE_RECORD,
    { entity, id },
  )
  return consumeAutomationToastsFromRecord(data.softDeleteRecord)
}

export async function deleteRecordViaGraphQL(
  entity: string,
  id: string,
): Promise<boolean> {
  const data = await graphqlRequest<{ deleteRecord: boolean }>(DELETE_RECORD, {
    entity,
    id,
  })
  return Boolean(data.deleteRecord)
}

export async function restoreRecordViaGraphQL(
  entity: string,
  id: string,
): Promise<Record<string, unknown>> {
  const data = await graphqlRequest<{ restoreRecord: Record<string, unknown> }>(
    RESTORE_RECORD,
    { entity, id },
  )
  return data.restoreRecord
}

export function canUseRecordsGraphQL(): boolean {
  return featureFlags.recordsFromGraphQL
}
