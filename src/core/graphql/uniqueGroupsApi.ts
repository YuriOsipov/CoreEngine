import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

export interface EntityUniqueGroupDto {
  name: string
  fields: string[]
}

const UPSERT_UNIQUE_GROUPS = /* GraphQL */ `
  mutation UpsertEntityUniqueGroups(
    $entity: String!
    $groups: [EntityUniqueGroupInput!]!
    $applyIndexes: Boolean
  ) {
    upsertEntityUniqueGroups(
      entity: $entity
      groups: $groups
      applyIndexes: $applyIndexes
    ) {
      name
      fields
    }
  }
`

const SET_FIELD_UNIQUE = /* GraphQL */ `
  mutation SetFieldIsUnique(
    $entity: String!
    $field: String!
    $isUnique: Boolean!
    $applyIndexes: Boolean
  ) {
    setFieldIsUnique(
      entity: $entity
      field: $field
      isUnique: $isUnique
      applyIndexes: $applyIndexes
    )
  }
`

const ENTITY_UNIQUE_GROUPS_QUERY = /* GraphQL */ `
  query EntityUniqueGroups($apiName: String!) {
    entitySchema(apiName: $apiName) {
      apiName
      uniqueGroups { name fields }
      fields {
        apiName
        label
        isUnique
        type
        hidden
        isSystem
      }
    }
  }
`

export async function fetchEntityUniqueGroups(apiName: string): Promise<{
  uniqueGroups: EntityUniqueGroupDto[]
  fields: Array<{
    apiName: string
    label: string
    isUnique: boolean
    type: string
    hidden: boolean
    isSystem: boolean
  }>
}> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('fetchEntityUniqueGroups')
  }
  const data = await graphqlRequest<{
    entitySchema: {
      uniqueGroups: EntityUniqueGroupDto[]
      fields: Array<{
        apiName: string
        label: string
        isUnique: boolean
        type: string
        hidden: boolean
        isSystem: boolean
      }>
    }
  }>(ENTITY_UNIQUE_GROUPS_QUERY, { apiName })
  return {
    uniqueGroups: data.entitySchema.uniqueGroups ?? [],
    fields: data.entitySchema.fields ?? [],
  }
}

export async function upsertEntityUniqueGroups(
  entity: string,
  groups: EntityUniqueGroupDto[],
  applyIndexes = true,
): Promise<EntityUniqueGroupDto[]> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('upsertEntityUniqueGroups')
  }
  const data = await graphqlRequest<{
    upsertEntityUniqueGroups: EntityUniqueGroupDto[]
  }>(UPSERT_UNIQUE_GROUPS, { entity, groups, applyIndexes })
  return data.upsertEntityUniqueGroups ?? []
}

export async function setFieldIsUnique(
  entity: string,
  field: string,
  isUnique: boolean,
  applyIndexes = true,
): Promise<boolean> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('setFieldIsUnique')
  }
  const data = await graphqlRequest<{ setFieldIsUnique: boolean }>(
    SET_FIELD_UNIQUE,
    { entity, field, isUnique, applyIndexes },
  )
  return Boolean(data.setFieldIsUnique)
}
