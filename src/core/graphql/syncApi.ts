import { graphqlRequest } from './client'

export interface GraphQlSyncJob {
  id: string
  entityId: string | null
  jobType: string
  status: string
  payload: Record<string, unknown>
  result: Record<string, unknown>
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface GraphQlEntitySyncState {
  entityId: string
  entityApiName: string
  lastSyncedVersion: number | null
  lastSyncedAt: string | null
  status: string
  lastError: string | null
  backendSnapshot: Record<string, unknown>
  updatedAt: string
}

export interface GraphQlSchemaDriftItem {
  kind: string
  entityApiName: string
  fieldApiName: string | null
  registryValue: string | null
  backendValue: string | null
  message: string
}

export interface GraphQlEntityDriftReport {
  entityId: string
  entityApiName: string
  backendTarget: string
  status: string
  drift: GraphQlSchemaDriftItem[]
}

const SCHEMA_DRIFT_QUERY = /* GraphQL */ `
  query SchemaDrift($entity: String) {
    schemaDrift(entity: $entity) {
      entityId
      entityApiName
      backendTarget
      status
      drift {
        kind
        entityApiName
        fieldApiName
        registryValue
        backendValue
        message
      }
    }
  }
`

const ENTITY_SYNC_STATES_QUERY = /* GraphQL */ `
  query EntitySyncStates {
    entitySyncStates {
      entityId
      entityApiName
      lastSyncedVersion
      lastSyncedAt
      status
      lastError
      backendSnapshot
      updatedAt
    }
  }
`

const SYNC_JOBS_QUERY = /* GraphQL */ `
  query SyncJobs($limit: Int) {
    syncJobs(limit: $limit) {
      id
      entityId
      jobType
      status
      payload
      result
      error
      createdAt
      startedAt
      finishedAt
    }
  }
`

const RUN_SCHEMA_DRIFT_CHECK = /* GraphQL */ `
  mutation RunSchemaDriftCheck($entity: String) {
    runSchemaDriftCheck(entity: $entity) {
      id
      entityId
      jobType
      status
      payload
      result
      error
      createdAt
      startedAt
      finishedAt
    }
  }
`

const RUN_SCHEMA_SYNC = /* GraphQL */ `
  mutation RunSchemaSync($entity: String!, $dryRun: Boolean) {
    runSchemaSync(entity: $entity, dryRun: $dryRun) {
      id
      entityId
      jobType
      status
      payload
      result
      error
      createdAt
      startedAt
      finishedAt
    }
  }
`

export async function fetchSchemaDriftFromGraphQL(
  entity?: string | null,
): Promise<GraphQlEntityDriftReport[]> {
  const data = await graphqlRequest<{ schemaDrift: GraphQlEntityDriftReport[] }>(
    SCHEMA_DRIFT_QUERY,
    { entity: entity ?? null },
  )
  return data.schemaDrift ?? []
}

export async function fetchEntitySyncStatesFromGraphQL(): Promise<GraphQlEntitySyncState[]> {
  const data = await graphqlRequest<{ entitySyncStates: GraphQlEntitySyncState[] }>(
    ENTITY_SYNC_STATES_QUERY,
  )
  return data.entitySyncStates ?? []
}

export async function fetchSyncJobsFromGraphQL(limit = 20): Promise<GraphQlSyncJob[]> {
  const data = await graphqlRequest<{ syncJobs: GraphQlSyncJob[] }>(SYNC_JOBS_QUERY, {
    limit,
  })
  return data.syncJobs ?? []
}

export async function runSchemaDriftCheckViaGraphQL(
  entity?: string | null,
): Promise<GraphQlSyncJob> {
  const data = await graphqlRequest<{ runSchemaDriftCheck: GraphQlSyncJob }>(
    RUN_SCHEMA_DRIFT_CHECK,
    { entity: entity ?? null },
  )
  return data.runSchemaDriftCheck
}

export async function runSchemaSyncViaGraphQL(
  entity: string,
  dryRun = true,
): Promise<GraphQlSyncJob> {
  const data = await graphqlRequest<{ runSchemaSync: GraphQlSyncJob }>(RUN_SCHEMA_SYNC, {
    entity,
    dryRun,
  })
  return data.runSchemaSync
}
