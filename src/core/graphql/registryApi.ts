import { graphqlRequest } from './client'
import { featureFlags, refuseLegacyFallback } from './featureFlags'
import {
  flattenRegistrySnapshot,
  type RegistryEntityDto,
} from './schemaMapper'
import type {
  CollectionDefinition,
  FieldDefinition,
  RelationDefinition,
} from '@/interfaces'

const HEALTH_QUERY = /* GraphQL */ `
  query Health {
    health {
      ok
      service
      registryEntities
      translationEntries
    }
  }
`

const ENTITY_SCHEMA_QUERY = /* GraphQL */ `
  query EntitySchema($apiName: String!, $language: String) {
    entitySchema(apiName: $apiName, language: $language) {
      id
      apiName
      label
      note
      icon
      singleton
      group
      displayTemplate
      backendTarget
      backendConfig
      uniqueGroups { name fields }
      labelTranslations { language label }
      hidden
      accountability
      internal
      fields {
        id
        apiName
        label
        type
        interface
        options
        displayOptions
        labelTranslations { language label }
        required
        readonly
        hidden
        sort
        isSystem
        isUnique
      }
      relations {
        id
        kind
        fieldApiName
        relatedEntityApiName
        junctionEntityApiName
        allowedEntityApiNames
        meta
      }
    }
  }
`

const REGISTRY_SNAPSHOT_QUERY = /* GraphQL */ `
  query RegistrySnapshot($includeHidden: Boolean) {
    registrySnapshot(includeHidden: $includeHidden) {
      id
      apiName
      label
      note
      icon
      singleton
      group
      displayTemplate
      backendTarget
      backendConfig
      uniqueGroups { name fields }
      labelTranslations { language label }
      hidden
      accountability
      internal
      fields {
        id
        apiName
        label
        type
        interface
        options
        displayOptions
        labelTranslations { language label }
        required
        readonly
        hidden
        sort
        isSystem
        isUnique
      }
      relations {
        id
        kind
        fieldApiName
        relatedEntityApiName
        junctionEntityApiName
        allowedEntityApiNames
        meta
      }
    }
  }
`

const TRANSLATIONS_QUERY = /* GraphQL */ `
  query Translations($language: String!, $namespace: String, $prefix: String) {
    translations(language: $language, namespace: $namespace, prefix: $prefix) {
      key
      language
      value
      namespace
    }
  }
`

export async function fetchBffHealth() {
  return graphqlRequest<{
    health: {
      ok: boolean
      service: string
      registryEntities: number
      translationEntries: number
    }
  }>(HEALTH_QUERY)
}

export async function fetchEntitySchemaFromGraphQL(
  apiName: string,
  language?: string,
) {
  const data = await graphqlRequest<{
    entitySchema: RegistryEntityDto
  }>(ENTITY_SCHEMA_QUERY, { apiName, language: language ?? null })
  return data.entitySchema
}

export async function fetchRegistrySnapshotFromGraphQL(
  includeHidden = true,
): Promise<{
  collections: CollectionDefinition[]
  fields: FieldDefinition[]
  relations: RelationDefinition[]
}> {
  const data = await graphqlRequest<{
    registrySnapshot: RegistryEntityDto[]
  }>(REGISTRY_SNAPSHOT_QUERY, { includeHidden })
  return flattenRegistrySnapshot(data.registrySnapshot ?? [])
}

export async function fetchTranslationsFromGraphQL(
  language: string,
  options?: { namespace?: string; prefix?: string },
) {
  const data = await graphqlRequest<{
    translations: Array<{
      key: string
      language: string
      value: string
      namespace: string
    }>
  }>(TRANSLATIONS_QUERY, {
    language,
    namespace: options?.namespace ?? null,
    prefix: options?.prefix ?? null,
  })
  return data.translations
}

/** Dictionary rows — GraphQL only. */
export async function fetchTranslationsBridge(
  language: string,
  options?: { namespace?: string; prefix?: string },
): Promise<Array<{ key: string; language: string; value: string }>> {
  if (!featureFlags.translationsFromGraphQL) {
    refuseLegacyFallback('fetchTranslationsBridge')
  }
  return fetchTranslationsFromGraphQL(language, options)
}

export function canUseRegistryGraphQL(): boolean {
  return featureFlags.schemaFromGraphQL
}
