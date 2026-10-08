import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

export interface GraphQlRecordActivity {
  id: string
  entityApiName: string
  recordId: string
  action: string
  userId: string | null
  comment: string | null
  createdAt: string
  revisionIds: string[]
}

export interface GraphQlRecordRevision {
  id: string
  activityId: string | null
  entityApiName: string
  recordId: string
  snapshot: Record<string, unknown>
  parentRevisionId: string | null
  createdAt: string
}

const RECORD_ACTIVITIES_QUERY = /* GraphQL */ `
  query RecordActivities(
    $entity: String!
    $recordId: ID!
    $actions: [String!]
    $limit: Int
  ) {
    recordActivities(
      entity: $entity
      recordId: $recordId
      actions: $actions
      limit: $limit
    ) {
      id
      entityApiName
      recordId
      action
      userId
      comment
      createdAt
      revisionIds
    }
  }
`

const RECORD_REVISIONS_QUERY = /* GraphQL */ `
  query RecordRevisions($entity: String!, $recordId: ID!, $limit: Int) {
    recordRevisions(entity: $entity, recordId: $recordId, limit: $limit) {
      id
      activityId
      entityApiName
      recordId
      snapshot
      parentRevisionId
      createdAt
    }
  }
`

/** Map UI activity filters (create/update/delete) to platform audit actions. */
export function mapUiActionsToPlatform(
  actions: Array<'create' | 'update' | 'delete'>,
): string[] {
  const mapped = new Set<string>()
  for (const action of actions) {
    if (action === 'create') mapped.add('CREATE')
    if (action === 'update') {
      mapped.add('UPDATE')
      mapped.add('RESTORE')
      mapped.add('RESTORE_REVISION')
    }
    if (action === 'delete') mapped.add('SOFT_DELETE')
  }
  return [...mapped]
}

export function mapPlatformActionToUi(action: string): string {
  switch (action) {
    case 'CREATE':
      return 'create'
    case 'SOFT_DELETE':
      return 'delete'
    case 'UPDATE':
    case 'RESTORE':
    case 'RESTORE_REVISION':
      return 'update'
    default:
      return action.toLowerCase()
  }
}

export async function fetchRecordActivitiesFromGraphQL(options: {
  entity: string
  recordId: string | number
  actions?: string[]
  limit?: number
}): Promise<GraphQlRecordActivity[]> {
  const data = await graphqlRequest<{
    recordActivities: GraphQlRecordActivity[]
  }>(RECORD_ACTIVITIES_QUERY, {
    entity: options.entity,
    recordId: String(options.recordId),
    actions: options.actions ?? null,
    limit: options.limit ?? 50,
  })
  return data.recordActivities ?? []
}

export async function fetchRecordRevisionsFromGraphQL(options: {
  entity: string
  recordId: string | number
  limit?: number
}): Promise<GraphQlRecordRevision[]> {
  const data = await graphqlRequest<{
    recordRevisions: GraphQlRecordRevision[]
  }>(RECORD_REVISIONS_QUERY, {
    entity: options.entity,
    recordId: String(options.recordId),
    limit: options.limit ?? 500,
  })
  return data.recordRevisions ?? []
}

export function canUseAuditGraphQL(): boolean {
  return featureFlags.auditFromGraphQL
}

/** Activities for a record — GraphQL only. */
export async function readRecordActivitiesBridge(options: {
  entity: string
  recordId: string | number
  actions?: string[]
  /** @deprecated Ignored — legacy UI action mapping path removed. */
  uiActions?: Array<'create' | 'update' | 'delete'>
  limit?: number
  fields?: string[]
}): Promise<Record<string, unknown>[]> {
  if (!canUseAuditGraphQL()) {
    refuseLegacyFallback('readRecordActivitiesBridge')
  }
  const rows = await fetchRecordActivitiesFromGraphQL({
    entity: options.entity,
    recordId: options.recordId,
    actions: options.actions,
    limit: options.limit,
  })

  return rows.map((row) => ({
    id: Number(row.id),
    action: mapPlatformActionToUi(row.action),
    timestamp: row.createdAt,
    user: row.userId ? { id: row.userId } : null,
    comment: row.comment,
    revisions: row.revisionIds.map((id) => ({ id: Number(id) })),
  }))
}

/** Revisions for a record — GraphQL only. */
export async function readRecordRevisionsBridge(options: {
  entity: string
  recordId: string | number
  limit?: number
}): Promise<Array<{ id: unknown; data: unknown; parent: unknown }>> {
  if (!canUseAuditGraphQL()) {
    refuseLegacyFallback('readRecordRevisionsBridge')
  }
  const revisions = await fetchRecordRevisionsFromGraphQL(options)
  return revisions.map((revision) => ({
    id: revision.id,
    data: revision.snapshot,
    parent: revision.parentRevisionId,
  }))
}
