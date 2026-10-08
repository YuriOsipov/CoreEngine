import {
  flattenRegistrySnapshot,
  type RegistryEntityDto,
  type RegistryFieldDto,
  type RegistryRelationDto,
} from '@/core/graphql/schemaMapper'
import type {
  CollectionDefinition,
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'
import { supabaseRestGet } from './restClient'

interface EntityRow {
  id: string
  api_name: string
  label: string
  icon?: string | null
  singleton?: boolean
  entity_group?: string | null
  display_template?: string | null
  backend_target?: string
  backend_config?: unknown
  label_translations?: unknown
  hidden?: boolean
  deleted_at?: string | null
}

interface FieldRow {
  id: string
  entity_id: string
  api_name: string
  label: string
  field_type: string
  interface: string
  options?: unknown
  display_options?: unknown
  label_translations?: unknown
  required?: boolean
  readonly?: boolean
  hidden?: boolean
  sort?: number
  is_system?: boolean
}

interface RelationRow {
  id: string
  entity_id: string
  field_id: string
  kind: string
  related_entity_id?: string | null
  junction_entity_id?: string | null
  allowed_entity_ids?: string[] | null
  meta?: unknown
}

function asTranslations(
  value: unknown,
): Array<{ language: string; label: string }> {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (row): row is { language?: unknown; label?: unknown } =>
        Boolean(row) && typeof row === 'object',
    )
    .map((row) => ({
      language: String(row.language ?? ''),
      label: String(row.label ?? ''),
    }))
    .filter((row) => row.language && row.label)
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function mapField(row: FieldRow): RegistryFieldDto {
  return {
    id: String(row.id),
    apiName: row.api_name,
    label: row.label,
    type: row.field_type,
    interface: row.interface,
    options: asObject(row.options),
    displayOptions: asObject(row.display_options),
    labelTranslations: asTranslations(row.label_translations),
    required: Boolean(row.required),
    readonly: Boolean(row.readonly),
    hidden: Boolean(row.hidden),
    sort: Number(row.sort ?? 0),
    isSystem: Boolean(row.is_system),
  }
}

function mapRelation(
  row: RelationRow,
  fieldApiName: string,
  apiNameById: Map<string, string>,
): RegistryRelationDto {
  const allowed = Array.isArray(row.allowed_entity_ids)
    ? row.allowed_entity_ids
        .map((id) => apiNameById.get(String(id)))
        .filter((name): name is string => Boolean(name))
    : []

  return {
    id: String(row.id),
    kind: row.kind,
    fieldApiName,
    relatedEntityApiName: row.related_entity_id
      ? apiNameById.get(String(row.related_entity_id)) ?? null
      : null,
    junctionEntityApiName: row.junction_entity_id
      ? apiNameById.get(String(row.junction_entity_id)) ?? null
      : null,
    allowedEntityApiNames: allowed,
    meta: asObject(row.meta),
  }
}

/** Load registry entities/fields/relations via PostgREST and flatten like GraphQL. */
export async function fetchRegistrySnapshotFromRest(
  includeHidden = true,
): Promise<{
  collections: CollectionDefinition[]
  fields: FieldDefinition[]
  relations: RelationDefinition[]
}> {
  const entities = await supabaseRestGet<EntityRow[]>('entities', {
    select: '*',
    deleted_at: 'is.null',
    order: 'api_name.asc',
  })

  const visible = includeHidden
    ? entities
    : entities.filter((row) => !row.hidden)

  if (visible.length === 0) {
    return { collections: [], fields: [], relations: [] }
  }

  const apiNameById = new Map(
    visible.map((row) => [String(row.id), row.api_name] as const),
  )
  // Include all non-deleted entities for relation target name resolution.
  for (const row of entities) {
    apiNameById.set(String(row.id), row.api_name)
  }

  const entityIds = visible.map((row) => String(row.id))
  const inFilter = `(${entityIds.join(',')})`

  const [fieldRows, relationRows] = await Promise.all([
    supabaseRestGet<FieldRow[]>('fields', {
      select: '*',
      entity_id: `in.${inFilter}`,
      order: 'sort.asc,api_name.asc',
    }),
    supabaseRestGet<RelationRow[]>('relations', {
      select: '*',
      entity_id: `in.${inFilter}`,
    }),
  ])

  const fieldsByEntity = new Map<string, FieldRow[]>()
  for (const field of fieldRows) {
    const list = fieldsByEntity.get(String(field.entity_id)) ?? []
    list.push(field)
    fieldsByEntity.set(String(field.entity_id), list)
  }

  const fieldApiById = new Map(
    fieldRows.map((row) => [String(row.id), row.api_name] as const),
  )

  const relationsByEntity = new Map<string, RelationRow[]>()
  for (const relation of relationRows) {
    const list = relationsByEntity.get(String(relation.entity_id)) ?? []
    list.push(relation)
    relationsByEntity.set(String(relation.entity_id), list)
  }

  const dtos: RegistryEntityDto[] = visible.map((row) => {
    const fields = (fieldsByEntity.get(String(row.id)) ?? []).map(mapField)
    const relations = (relationsByEntity.get(String(row.id)) ?? [])
      .map((relation) => {
        const fieldApiName = fieldApiById.get(String(relation.field_id))
        if (!fieldApiName) return null
        return mapRelation(relation, fieldApiName, apiNameById)
      })
      .filter((relation): relation is RegistryRelationDto => relation !== null)

    return {
      id: String(row.id),
      apiName: row.api_name,
      label: row.label,
      note:
        row.backend_config &&
        typeof row.backend_config === 'object' &&
        typeof (row.backend_config as Record<string, unknown>).note === 'string'
          ? String((row.backend_config as Record<string, unknown>).note)
          : null,
      icon: row.icon ?? null,
      singleton: Boolean(row.singleton),
      group: row.entity_group ?? null,
      displayTemplate: row.display_template ?? null,
      backendTarget: row.backend_target ?? 'SUPABASE',
      backendConfig:
        row.backend_config && typeof row.backend_config === 'object'
          ? (row.backend_config as Record<string, unknown>)
          : {},
      labelTranslations: asTranslations(row.label_translations),
      hidden: Boolean(row.hidden),
      accountability:
        row.backend_config &&
        typeof row.backend_config === 'object' &&
        'accountability' in (row.backend_config as Record<string, unknown>)
          ? ((row.backend_config as Record<string, unknown>).accountability as
              | string
              | null)
          : 'all',
      fields,
      relations,
    }
  })

  return flattenRegistrySnapshot(dtos)
}
