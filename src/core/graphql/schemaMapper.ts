import type {
  CollectionDefinition,
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'

export interface RegistryFieldDto {
  id: string
  apiName: string
  label: string
  type: string
  interface: string
  options?: Record<string, unknown> | null
  displayOptions?: Record<string, unknown> | null
  labelTranslations?: Array<{ language: string; label: string }>
  required: boolean
  readonly: boolean
  hidden: boolean
  sort: number
  isSystem: boolean
  isUnique?: boolean
}

export interface RegistryRelationDto {
  id: string
  kind: string
  fieldApiName: string
  relatedEntityApiName?: string | null
  junctionEntityApiName?: string | null
  allowedEntityApiNames: string[]
  meta?: Record<string, unknown> | null
}

export interface RegistryEntityDto {
  id: string
  apiName: string
  label: string
  note?: string | null
  icon?: string | null
  singleton: boolean
  group?: string | null
  displayTemplate?: string | null
  backendTarget: string
  backendConfig?: Record<string, unknown> | null
  uniqueGroups?: Array<{ name: string; fields: string[] }> | null
  labelTranslations?: Array<{ language: string; label: string }>
  hidden: boolean
  accountability?: string | null
  internal?: boolean | null
  fields: RegistryFieldDto[]
  relations: RegistryRelationDto[]
}

function mapFieldTypeToSchema(type: string): string {
  switch (type.toUpperCase()) {
    case 'INTEGER':
      return 'integer'
    case 'FLOAT':
      return 'float'
    case 'BOOLEAN':
      return 'boolean'
    case 'UUID':
      return 'uuid'
    case 'JSON':
      return 'json'
    case 'DATETIME':
      return 'timestamp'
    case 'DATE':
      return 'date'
    case 'TIME':
      return 'time'
    case 'TEXT':
      return 'text'
    case 'ALIAS':
      return 'alias'
    default:
      return 'string'
  }
}

function inferSpecial(iface: string): string[] | null {
  const value = iface.toLowerCase()
  if (value.includes('m2a')) return ['m2a']
  if (value.includes('files') || value === 'files') return ['files']
  if (value === 'file' || value.includes('file-image')) return ['file']
  if (value.includes('m2m')) return ['m2m']
  if (value.includes('o2m')) return ['o2m']
  if (value.includes('m2o')) return ['m2o']
  if (value === 'address' || value.includes('address')) return ['address']
  if (value === 'json-list' || value.includes('json-list')) return ['json-list']
  return null
}

/** Canonicalize Directus/legacy interface names used in the registry. */
export function normalizeFieldInterface(iface: string): string {
  const value = String(iface || '').toLowerCase().trim()
  if (value === 'select') return 'select-dropdown'
  if (value === 'textarea') return 'input-multiline'
  if (value === 'editor') return 'input-rich-text-html'
  if (value === 'datepicker') return 'datetime'
  if (value === 'toggle') return 'boolean'
  if (value === 'password') return 'input-hash'
  if (value === 'file') return 'file'
  if (value === 'files') return 'files'
  if (value === 'm2a') return 'list-m2a'
  if (value === 'm2o') return 'select-dropdown-m2o'
  if (value === 'o2m') return 'list-o2m'
  if (value === 'm2m') return 'list-m2m'
  if (value === 'currency') return 'currency'
  if (value === 'address') return 'address'
  if (value === 'json-list') return 'json-list'
  if (value === 'input-code') return 'input-code'
  if (value === 'input' || !value) return 'input'
  return iface
}

export function mapRegistryEntityToCollection(
  entity: RegistryEntityDto,
): CollectionDefinition {
  const description =
    (typeof entity.note === 'string' && entity.note.trim()
      ? entity.note.trim()
      : null) ??
    (typeof entity.backendConfig?.note === 'string' &&
    entity.backendConfig.note.trim()
      ? String(entity.backendConfig.note).trim()
      : null)
  return {
    collection: entity.apiName,
    meta: {
      hidden: entity.hidden,
      singleton: entity.singleton,
      icon: entity.icon ?? null,
      // Display label for Object Manager / navigation (entities.label).
      note: entity.label,
      description,
      display_template: entity.displayTemplate ?? null,
      group: entity.group ?? null,
      translations: (entity.labelTranslations ?? []).map((row) => ({
        language: row.language,
        translation: row.label,
      })),
      unique_groups: entity.uniqueGroups ?? [],
      accountability:
        entity.accountability ?? entity.backendConfig?.accountability ?? 'all',
      internal:
        entity.internal === true ||
        entity.backendConfig?.internal === true,
    },
    schema: { name: entity.apiName },
  }
}

export function mapRegistryFieldToSchema(
  entityApiName: string,
  field: RegistryFieldDto,
): FieldDefinition {
  return {
    collection: entityApiName,
    field: field.apiName,
    type: mapFieldTypeToSchema(field.type),
    meta: {
      interface: normalizeFieldInterface(field.interface),
      options: (field.options as Record<string, unknown>) ?? null,
      display_options: (field.displayOptions as Record<string, unknown>) ?? null,
      required: field.required,
      readonly: field.readonly,
      hidden: field.hidden,
      sort: field.sort,
      special: inferSpecial(field.interface),
      note: field.label,
      unique: Boolean(field.isUnique),
      translations: (field.labelTranslations ?? []).map((row) => ({
        language: row.language,
        translation: row.label,
      })),
    },
    schema: {
      is_primary_key: field.apiName === 'id',
      foreign_key_table: null,
      foreign_key_column: null,
      default_value: (() => {
        const options = (field.options as Record<string, unknown> | null) ?? null
        if (!options) return undefined
        if (options.default !== undefined) return options.default
        if (options.defaultValue !== undefined) return options.defaultValue
        return undefined
      })(),
    },
  }
}

export function mapRegistryRelationToSchema(
  entityApiName: string,
  relation: RegistryRelationDto,
): RelationDefinition {
  const meta = {
    ...(relation.meta ?? {}),
  } as NonNullable<RelationDefinition['meta']>

  if ((relation.allowedEntityApiNames ?? []).length > 0) {
    meta.one_allowed_collections = relation.allowedEntityApiNames
  }
  if (relation.kind === 'M2A') {
    // Parent-side M2A: one_* is the parent entity/field; many_* is the junction.
    // Do not overwrite seeded meta.one_collection with the junction name.
    if (relation.junctionEntityApiName) {
      meta.many_collection =
        meta.many_collection ?? relation.junctionEntityApiName
    }
    meta.one_collection = meta.one_collection ?? entityApiName
    meta.one_field = meta.one_field ?? relation.fieldApiName
  }

  if (relation.kind === 'M2M') {
    if (relation.junctionEntityApiName) {
      meta.many_collection =
        meta.many_collection ?? relation.junctionEntityApiName
    }
    meta.one_collection = meta.one_collection ?? entityApiName
    meta.one_field = meta.one_field ?? relation.fieldApiName
    meta.kind = 'M2M'
  }

  return {
    collection: entityApiName,
    field: relation.fieldApiName,
    related_collection: relation.relatedEntityApiName ?? null,
    meta,
  }
}

export function flattenRegistrySnapshot(entities: RegistryEntityDto[]): {
  collections: CollectionDefinition[]
  fields: FieldDefinition[]
  relations: RelationDefinition[]
} {
  const collections: CollectionDefinition[] = []
  const fields: FieldDefinition[] = []
  const relations: RelationDefinition[] = []

  for (const entity of entities) {
    collections.push(mapRegistryEntityToCollection(entity))
    for (const field of entity.fields ?? []) {
      fields.push(mapRegistryFieldToSchema(entity.apiName, field))
    }
    for (const relation of entity.relations ?? []) {
      relations.push(mapRegistryRelationToSchema(entity.apiName, relation))
    }
  }

  return { collections, fields, relations }
}
