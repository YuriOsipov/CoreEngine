import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

export interface CreateRegistryEntityInput {
  apiName: string
  label: string
  note?: string | null
  icon?: string | null
  singleton?: boolean
  hidden?: boolean
  displayTemplate?: string | null
  group?: string | null
}

export interface CreatedRegistryEntityDto {
  id: string
  apiName: string
  label: string
  note: string | null
  icon: string | null
  hidden: boolean
  singleton: boolean
}

const CREATE_ENTITY = /* GraphQL */ `
  mutation CreateRegistryEntity(
    $input: CreateRegistryEntityInput!
    $applyDdl: Boolean
  ) {
    createRegistryEntity(input: $input, applyDdl: $applyDdl) {
      id
      apiName
      label
      note
      icon
      hidden
      singleton
    }
  }
`

export async function createRegistryEntityViaGraphQL(
  input: CreateRegistryEntityInput,
  applyDdl = true,
): Promise<CreatedRegistryEntityDto> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('createRegistryEntityViaGraphQL')
  }
  const data = await graphqlRequest<{
    createRegistryEntity: CreatedRegistryEntityDto
  }>(CREATE_ENTITY, { input, applyDdl })
  return data.createRegistryEntity
}

const DELETE_ENTITY = /* GraphQL */ `
  mutation DeleteRegistryEntity($entity: String!) {
    deleteRegistryEntity(entity: $entity)
  }
`

export async function deleteRegistryEntityViaGraphQL(
  entity: string,
): Promise<boolean> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('deleteRegistryEntityViaGraphQL')
  }
  const data = await graphqlRequest<{ deleteRegistryEntity: boolean }>(
    DELETE_ENTITY,
    { entity },
  )
  return Boolean(data.deleteRegistryEntity)
}
