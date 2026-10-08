/**
 * Hasura metadata admin API (reload after local DDL so new columns appear in GraphQL).
 */
import { hasuraAdminSecret, hasuraGraphqlUrl } from './client.js'
import { clearHasuraRecordsCache } from './records.js'

function hasuraMetadataUrl(): string {
  const graphql = hasuraGraphqlUrl()
  if (graphql.endsWith('/v1/graphql')) {
    return `${graphql.slice(0, -'/v1/graphql'.length)}/v1/metadata`
  }
  return `${graphql.replace(/\/$/, '')}/v1/metadata`
}

/** Reload Hasura metadata so newly added Postgres columns are exposed. */
export async function reloadHasuraMetadata(): Promise<void> {
  const secret = hasuraAdminSecret()
  const response = await fetch(hasuraMetadataUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'x-hasura-admin-secret': secret } : {}),
    },
    body: JSON.stringify({
      type: 'reload_metadata',
      args: {
        reload_remote_schemas: true,
        reload_sources: true,
      },
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Hasura reload_metadata failed (HTTP ${response.status})${text ? `: ${text}` : ''}`,
    )
  }
  clearHasuraRecordsCache()
}
