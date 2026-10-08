/**
 * Server-side Hasura GraphQL client (admin secret).
 * Vue never calls Hasura; crm-bff is the only consumer.
 */

export function hasuraGraphqlUrl(): string {
  const raw = (
    process.env.HASURA_GRAPHQL_URL ||
    'http://localhost:8090/v1/graphql'
  ).trim()
  const trimmed = raw.replace(/\/$/, '')
  if (trimmed.endsWith('/v1/graphql')) return trimmed
  return `${trimmed}/v1/graphql`
}

export function hasuraAdminSecret(): string {
  return (process.env.HASURA_ADMIN_SECRET || 'myadminsecretkey').trim()
}

export interface HasuraResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

export async function hasuraRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  endpoint?: string,
): Promise<T> {
  const url = endpoint?.trim()
    ? endpoint.trim().replace(/\/$/, '').endsWith('/v1/graphql')
      ? endpoint.trim().replace(/\/$/, '')
      : `${endpoint.trim().replace(/\/$/, '')}/v1/graphql`
    : hasuraGraphqlUrl()
  const secret = hasuraAdminSecret()
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(secret ? { 'x-hasura-admin-secret': secret } : {}),
    },
    body: JSON.stringify({ query, variables }),
  })

  const payload = (await response.json()) as HasuraResponse<T>
  if (!response.ok) {
    const fromBody = payload.errors?.map((error) => error.message).join('; ')
    throw new Error(fromBody || `Hasura HTTP ${response.status}`)
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '))
  }
  if (!payload.data) {
    throw new Error('Hasura response missing data')
  }
  return payload.data
}

/** Serialize a JS value as a GraphQL input literal (unquoted object keys). */
export function graphqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((entry) => graphqlLiteral(entry)).join(', ')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    )
    return `{${entries
      .map(([key, v]) => `${assertGqlName(key)}: ${graphqlLiteral(v)}`)
      .join(', ')}}`
  }
  return JSON.stringify(String(value))
}

export function assertGqlName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid GraphQL identifier: ${name}`)
  }
  return name
}
