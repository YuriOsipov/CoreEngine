import { graphqlRequest } from './client'
import { featureFlags } from './featureFlags'

const FILE_QUERY = /* GraphQL */ `
  query File($id: ID!, $fields: [String!]) {
    file(id: $id, fields: $fields)
  }
`

const FILES_QUERY = /* GraphQL */ `
  query Files($ids: [ID!]!, $fields: [String!]) {
    files(ids: $ids, fields: $fields)
  }
`

const RECORD_FILES_QUERY = /* GraphQL */ `
  query RecordFiles($collection: String!, $recordId: ID!, $fields: [String!]) {
    recordFiles(collection: $collection, recordId: $recordId, fields: $fields)
  }
`

export async function fetchFileFromGraphQL(
  id: string,
  fields?: string[],
): Promise<Record<string, unknown>> {
  const data = await graphqlRequest<{ file: Record<string, unknown> }>(FILE_QUERY, {
    id,
    fields: fields ?? null,
  })
  return data.file
}

export async function fetchFilesFromGraphQL(
  ids: string[],
  fields?: string[],
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return []
  const data = await graphqlRequest<{ files: Record<string, unknown>[] }>(FILES_QUERY, {
    ids,
    fields: fields ?? null,
  })
  return data.files ?? []
}

export async function fetchRecordFilesFromGraphQL(
  collection: string,
  recordId: string,
  fields?: string[],
): Promise<Record<string, unknown>[]> {
  const data = await graphqlRequest<{ recordFiles: Record<string, unknown>[] }>(
    RECORD_FILES_QUERY,
    {
      collection,
      recordId,
      fields: fields ?? null,
    },
  )
  return data.recordFiles ?? []
}

export function canUseFilesGraphQL(): boolean {
  return featureFlags.recordsFromGraphQL
}
