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
  /** M2O field for parent-owner inheritance on create; null = creator owns the row. */
  inheritOwnerFrom: string | null
  /** Extra fields that grant read when equal to me (OR owner). */
  rowLevelReadAlsoIf: string[]
  /** Same app role as owner may read (MVP; Teams later). */
  rowLevelReadAlsoIfSameRole: boolean
  fields: Array<{
    apiName: string
    label: string
    type: string
    hidden: boolean
    isSystem: boolean
    relationKind?: string | null
    relatedEntityApiName?: string | null
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
  inheritOwnerFrom?: string | null
  rowLevelReadAlsoIf?: string[] | null
  rowLevelReadAlsoIfSameRole?: boolean | null
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
      inheritOwnerFrom
      rowLevelReadAlsoIf
      rowLevelReadAlsoIfSameRole
      fields {
        apiName
        label
        type
        hidden
        isSystem
        relationKind
        relatedEntityApiName
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
      inheritOwnerFrom
      rowLevelReadAlsoIf
      rowLevelReadAlsoIfSameRole
    }
  }
`

function normalizeRowLevelSecurity(raw: unknown): 'owner' | null {
  return raw === 'owner' ? 'owner' : null
}

function normalizeReadAlsoIf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const field = entry.trim().toLowerCase()
    if (!field || !/^[a-z][a-z0-9_]*$/.test(field)) continue
    if (field === 'owner_id' || field === 'user_created') continue
    if (seen.has(field)) continue
    seen.add(field)
    out.push(field)
  }
  return out
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
      inheritOwnerFrom?: string | null
      rowLevelReadAlsoIf?: string[] | null
      rowLevelReadAlsoIfSameRole?: boolean | null
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
    inheritOwnerFrom:
      typeof row.inheritOwnerFrom === 'string' && row.inheritOwnerFrom.trim()
        ? row.inheritOwnerFrom.trim()
        : null,
    rowLevelReadAlsoIf: normalizeReadAlsoIf(row.rowLevelReadAlsoIf),
    rowLevelReadAlsoIfSameRole: Boolean(row.rowLevelReadAlsoIfSameRole),
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
      inheritOwnerFrom?: string | null
      rowLevelReadAlsoIf?: string[] | null
      rowLevelReadAlsoIfSameRole?: boolean | null
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
    inheritOwnerFrom:
      typeof row.inheritOwnerFrom === 'string' && row.inheritOwnerFrom.trim()
        ? row.inheritOwnerFrom.trim()
        : null,
    rowLevelReadAlsoIf: normalizeReadAlsoIf(row.rowLevelReadAlsoIf),
    rowLevelReadAlsoIfSameRole: Boolean(row.rowLevelReadAlsoIfSameRole),
  }
}
