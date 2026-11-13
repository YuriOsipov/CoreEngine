import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'
import { extractTemplateFields } from '@/modules/entities/utils/recordDisplay'

export type EntityAccountability = 'all' | 'activity' | null

export interface EntityMetaDto {
  apiName: string
  label: string
  note: string | null
  icon: string | null
  displayTemplate: string | null
  hidden: boolean
  singleton: boolean
  internal: boolean
  accountability: EntityAccountability
  /** Default sensitivity for new fields (0 none, 1 restricted, 2 confidential). */
  defaultFieldSensitivity: number
  /** `owner` = non-admins only access rows they created; null = off. */
  rowLevelSecurity: 'owner' | null
  fields: Array<{
    apiName: string
    label: string
    type: string
    hidden: boolean
    isSystem: boolean
  }>
}

export interface UpdateEntityMetaInput {
  label?: string | null
  note?: string | null
  icon?: string | null
  displayTemplate?: string | null
  hidden?: boolean | null
  singleton?: boolean | null
  internal?: boolean | null
  accountability?: EntityAccountability
  defaultFieldSensitivity?: number | null
  rowLevelSecurity?: 'owner' | null
}

const ENTITY_META_QUERY = /* GraphQL */ `
  query EntityMeta($apiName: String!) {
    entitySchema(apiName: $apiName) {
      apiName
      label
      note
      icon
      displayTemplate
      hidden
      singleton
      internal
      accountability
      defaultFieldSensitivity
      rowLevelSecurity
      fields {
        apiName
        label
        type
        hidden
        isSystem
      }
    }
  }
`

const UPDATE_ENTITY_META = /* GraphQL */ `
  mutation UpdateEntityMeta($entity: String!, $input: UpdateEntityMetaInput!) {
    updateEntityMeta(entity: $entity, input: $input) {
      apiName
      label
      note
      icon
      displayTemplate
      hidden
      singleton
      internal
      accountability
      defaultFieldSensitivity
      rowLevelSecurity
    }
  }
`

function normalizeRowLevelSecurity(raw: unknown): 'owner' | null {
  return raw === 'owner' ? 'owner' : null
}

function normalizeAccountability(raw: unknown): EntityAccountability {
  if (raw === null || raw === 'none' || raw === '') return null
  if (raw === 'activity' || raw === 'all') return raw
  return 'all'
}

export function templateFieldsToTokens(fields: string[]): string {
  return fields
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => `{{${f}}}`)
    .join(' ')
}

export function tokensToTemplateFields(template: string | null | undefined): string[] {
  if (!template?.trim()) return []
  return extractTemplateFields(template)
}

export async function fetchEntityMeta(apiName: string): Promise<EntityMetaDto> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('fetchEntityMeta')
  }
  const data = await graphqlRequest<{
    entitySchema: {
      apiName: string
      label: string
      note?: string | null
      icon?: string | null
      displayTemplate?: string | null
      hidden: boolean
      singleton: boolean
      internal?: boolean | null
      accountability?: string | null
      defaultFieldSensitivity?: number | null
      rowLevelSecurity?: string | null
      fields: EntityMetaDto['fields']
    }
  }>(ENTITY_META_QUERY, { apiName })
  const row = data.entitySchema
  return {
    apiName: row.apiName,
    label: row.label,
    note: row.note ?? null,
    icon: row.icon ?? null,
    displayTemplate: row.displayTemplate ?? null,
    hidden: Boolean(row.hidden),
    singleton: Boolean(row.singleton),
    internal: Boolean(row.internal),
    accountability: normalizeAccountability(row.accountability),
    defaultFieldSensitivity: Number(row.defaultFieldSensitivity ?? 0) || 0,
    rowLevelSecurity: normalizeRowLevelSecurity(row.rowLevelSecurity),
    fields: row.fields ?? [],
  }
}

export async function updateEntityMeta(
  entity: string,
  input: UpdateEntityMetaInput,
): Promise<Omit<EntityMetaDto, 'fields'>> {
  if (!featureFlags.schemaFromGraphQL) {
    refuseLegacyFallback('updateEntityMeta')
  }
  const data = await graphqlRequest<{
    updateEntityMeta: {
      apiName: string
      label: string
      note?: string | null
      icon?: string | null
      displayTemplate?: string | null
      hidden: boolean
      singleton: boolean
      internal?: boolean | null
      accountability?: string | null
      defaultFieldSensitivity?: number | null
      rowLevelSecurity?: string | null
    }
  }>(UPDATE_ENTITY_META, { entity, input })
  const row = data.updateEntityMeta
  return {
    apiName: row.apiName,
    label: row.label,
    note: row.note ?? null,
    icon: row.icon ?? null,
    displayTemplate: row.displayTemplate ?? null,
    hidden: Boolean(row.hidden),
    singleton: Boolean(row.singleton),
    internal: Boolean(row.internal),
    accountability: normalizeAccountability(row.accountability),
    defaultFieldSensitivity: Number(row.defaultFieldSensitivity ?? 0) || 0,
    rowLevelSecurity: normalizeRowLevelSecurity(row.rowLevelSecurity),
  }
}
