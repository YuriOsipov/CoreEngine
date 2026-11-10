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
      backendConfig
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

/** Composite unique groups only (2+ fields) from entities.backend_config. */
export function parseConfigUniqueGroups(backendConfig: unknown): EntityUniqueGroupDto[] {
  if (!backendConfig || typeof backendConfig !== 'object' || Array.isArray(backendConfig)) {
    return []
  }
  const raw = (backendConfig as Record<string, unknown>).uniqueGroups
  if (!Array.isArray(raw)) return []
  const out: EntityUniqueGroupDto[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const fields = Array.isArray(row.fields)
      ? row.fields.map(String).map((f) => f.trim()).filter(Boolean)
      : []
    if (fields.length < 2) continue
    const name =
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim()
        : fields.join('_')
    const key = `${name}:${fields.join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, fields })
  }
  return out
}

/** Leftover 1-field groups wrongly stored in backend_config.uniqueGroups. */
export function parseConfigSingleFieldUniqueGroups(
  backendConfig: unknown,
): EntityUniqueGroupDto[] {
  if (!backendConfig || typeof backendConfig !== 'object' || Array.isArray(backendConfig)) {
    return []
  }
  const raw = (backendConfig as Record<string, unknown>).uniqueGroups
  if (!Array.isArray(raw)) return []
  const out: EntityUniqueGroupDto[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const fields = Array.isArray(row.fields)
      ? row.fields.map(String).map((f) => f.trim()).filter(Boolean)
      : []
    if (fields.length !== 1) continue
    const field = fields[0]!
    if (seen.has(field)) continue
    seen.add(field)
    out.push({
      name:
        typeof row.name === 'string' && row.name.trim()
          ? row.name.trim()
          : `field_${field}`,
      fields: [field],
    })
  }
  return out
}

export async function fetchEntityUniqueGroups(apiName: string): Promise<{
  /** Raw composite groups from backend_config (not effective merge with is_unique). */
  uniqueGroups: EntityUniqueGroupDto[]
  /** 1-field config leftovers that should be healed into is_unique. */
  legacySingleFieldGroups: EntityUniqueGroupDto[]
  fields: Array<{
    apiName: string
    label: string
    isUnique: boolean
    type: string
    hidden: boolean
    isSystem: boolean
  }>
  backendConfig: unknown
}> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('fetchEntityUniqueGroups')
  }
  const data = await graphqlRequest<{
    entitySchema: {
      backendConfig: unknown
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
  const backendConfig = data.entitySchema.backendConfig ?? {}
  return {
    uniqueGroups: parseConfigUniqueGroups(backendConfig),
    legacySingleFieldGroups: parseConfigSingleFieldUniqueGroups(backendConfig),
    fields: data.entitySchema.fields ?? [],
    backendConfig,
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
