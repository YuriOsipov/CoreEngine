import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'

export interface RegistryFieldDto {
  id: string
  apiName: string
  label: string
  type: string
  interface: string
  options: Record<string, unknown> | null
  displayOptions: Record<string, unknown> | null
  required: boolean
  readonly: boolean
  hidden: boolean
  sort: number
  isSystem: boolean
  isUnique: boolean
  isIndexed: boolean
}

export interface RegistryRelationDto {
  id: string
  kind: string
  fieldApiName: string
  relatedEntityApiName: string | null
  junctionEntityApiName: string | null
  meta: Record<string, unknown> | null
}

export interface RegistryFieldInputDto {
  apiName?: string
  label?: string
  type?: string
  interface?: string
  required?: boolean
  readonly?: boolean
  hidden?: boolean
  sort?: number
  options?: Record<string, unknown> | null
  displayOptions?: Record<string, unknown> | null
  isUnique?: boolean
  isIndexed?: boolean
  relationKind?: string | null
  relatedEntity?: string | null
  junctionEntity?: string | null
  relationMeta?: Record<string, unknown> | null
}

export interface RegistryFieldListRow extends RegistryFieldDto {
  relationKind: string | null
  relatedEntityApiName: string | null
  /** M2O FK ON DELETE rule from relations.meta.on_delete (default RESTRICT). */
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' | null
}

const FIELD_SELECTION = `
  id
  apiName
  label
  type
  interface
  options
  displayOptions
  required
  readonly
  hidden
  sort
  isSystem
  isUnique
  isIndexed
`

const ENTITY_FIELDS_QUERY = /* GraphQL */ `
  query EntityFieldsAndRelations($apiName: String!) {
    entitySchema(apiName: $apiName) {
      apiName
      fields { ${FIELD_SELECTION} }
      relations {
        id
        kind
        fieldApiName
        relatedEntityApiName
        junctionEntityApiName
        meta
      }
    }
  }
`

const CREATE_FIELD = /* GraphQL */ `
  mutation CreateRegistryField(
    $entity: String!
    $input: RegistryFieldInput!
    $applyDdl: Boolean
  ) {
    createRegistryField(entity: $entity, input: $input, applyDdl: $applyDdl) {
      ${FIELD_SELECTION}
    }
  }
`

const UPDATE_FIELD = /* GraphQL */ `
  mutation UpdateRegistryField(
    $id: ID!
    $input: RegistryFieldInput!
    $applyDdl: Boolean
  ) {
    updateRegistryField(id: $id, input: $input, applyDdl: $applyDdl) {
      ${FIELD_SELECTION}
    }
  }
`

const DELETE_FIELD = /* GraphQL */ `
  mutation DeleteRegistryField(
    $entity: String!
    $field: String!
    $applyDdl: Boolean
  ) {
    deleteRegistryField(entity: $entity, field: $field, applyDdl: $applyDdl)
  }
`

export async function fetchEntityFieldsAndRelations(apiName: string): Promise<{
  fields: RegistryFieldListRow[]
  relations: RegistryRelationDto[]
}> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('fetchEntityFieldsAndRelations')
  }
  const data = await graphqlRequest<{
    entitySchema: {
      fields: RegistryFieldDto[]
      relations: RegistryRelationDto[]
    }
  }>(ENTITY_FIELDS_QUERY, { apiName })

  const relations = data.entitySchema.relations ?? []
  const byField = new Map(relations.map((r) => [r.fieldApiName, r]))
  const fields = (data.entitySchema.fields ?? []).map((f) => {
    const rel = byField.get(f.apiName)
    const meta =
      rel?.meta && typeof rel.meta === 'object' && !Array.isArray(rel.meta)
        ? (rel.meta as Record<string, unknown>)
        : null
    const oneCollection =
      typeof meta?.one_collection === 'string' ? meta.one_collection.trim() : ''
    const onDeleteRaw =
      typeof meta?.on_delete === 'string' ? meta.on_delete.trim().toUpperCase() : ''
    const onDelete =
      onDeleteRaw === 'CASCADE' ||
      onDeleteRaw === 'SET NULL' ||
      onDeleteRaw === 'RESTRICT'
        ? (onDeleteRaw as 'CASCADE' | 'SET NULL' | 'RESTRICT')
        : rel?.kind === 'M2O'
          ? ('RESTRICT' as const)
          : null
    return {
      ...f,
      relationKind: rel?.kind ?? null,
      relatedEntityApiName:
        rel?.relatedEntityApiName ?? (oneCollection || null),
      onDelete,
    }
  })
  return { fields, relations }
}

export async function createRegistryFieldViaGraphQL(
  entity: string,
  input: RegistryFieldInputDto,
  applyDdl = true,
): Promise<RegistryFieldDto> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('createRegistryField')
  }
  const data = await graphqlRequest<{ createRegistryField: RegistryFieldDto }>(
    CREATE_FIELD,
    { entity, input, applyDdl },
  )
  return data.createRegistryField
}

export async function updateRegistryFieldViaGraphQL(
  id: string,
  input: RegistryFieldInputDto,
  applyDdl = true,
): Promise<RegistryFieldDto> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('updateRegistryField')
  }
  const data = await graphqlRequest<{ updateRegistryField: RegistryFieldDto }>(
    UPDATE_FIELD,
    { id, input, applyDdl },
  )
  return data.updateRegistryField
}

export async function deleteRegistryFieldViaGraphQL(
  entity: string,
  field: string,
  applyDdl = false,
): Promise<boolean> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('deleteRegistryField')
  }
  const data = await graphqlRequest<{ deleteRegistryField: boolean }>(
    DELETE_FIELD,
    { entity, field, applyDdl },
  )
  return Boolean(data.deleteRegistryField)
}
