export type DataSource = 'graphql' | 'legacy'
export type RegistrySource = 'graphql' | 'rest' | 'legacy'

function normalizeDataSource(value: string | undefined): DataSource {
  return value === 'graphql' ? 'graphql' : 'legacy'
}

export function getDataSource(): DataSource {
  return normalizeDataSource(import.meta.env.VITE_DATA_SOURCE)
}

export function getRecordsSource(): DataSource {
  const explicit = import.meta.env.VITE_RECORDS_SOURCE
  if (explicit === 'graphql') return 'graphql'
  if (explicit === 'legacy' || explicit === 'directus') return 'legacy'
  // Inherit from VITE_DATA_SOURCE when unset.
  return getDataSource()
}

/** Schema registry source. Unset inherits `VITE_DATA_SOURCE` (not REST). */
export function getRegistrySource(): RegistrySource {
  const explicit = import.meta.env.VITE_REGISTRY_SOURCE
  if (explicit === 'rest') return 'rest'
  if (explicit === 'graphql') return 'graphql'
  if (explicit === 'legacy' || explicit === 'directus') return 'legacy'
  return getDataSource()
}

export const featureFlags = {
  /** Opt-in PostgREST registry snapshot (`VITE_REGISTRY_SOURCE=rest`). */
  get schemaFromRest() {
    return getRegistrySource() === 'rest'
  },
  /** BFF GraphQL registry / sync — follows `VITE_DATA_SOURCE`, unless REST overrides metadata. */
  get schemaFromGraphQL() {
    return getDataSource() === 'graphql'
  },
  get translationsFromGraphQL() {
    return getDataSource() === 'graphql'
  },
  get layoutsFromGraphQL() {
    return getDataSource() === 'graphql'
  },
  get recordsFromGraphQL() {
    return getRecordsSource() === 'graphql'
  },
  get auditFromGraphQL() {
    return getRecordsSource() === 'graphql'
  },
}

/** True when layout/schema and records both use GraphQL (no intentional legacy SDK). */
export function isFullGraphqlMode(): boolean {
  return featureFlags.layoutsFromGraphQL && featureFlags.recordsFromGraphQL
}

/**
 * Throw when a GraphQL-primary bridge is called without GraphQL mode enabled.
 * Use after cutovers so hybrid legacy paths fail loudly.
 */
export function refuseLegacyFallback(purpose: string): never {
  throw new Error(
    `[graphql-cutover] Legacy fallback disabled; use VITE_DATA_SOURCE=graphql` +
      ` (and VITE_RECORDS_SOURCE=graphql for records). Refused: ${purpose}`,
  )
}
