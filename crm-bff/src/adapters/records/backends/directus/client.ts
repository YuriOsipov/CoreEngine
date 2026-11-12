/**
 * Server-side Directus GraphQL client (static token).
 * Vue never calls Directus; crm-bff is the only consumer.
 * DIRECTUS_RUNTIME stays off — this is GraphQL, not the retired HTTP SDK.
 */

export function directusGraphqlUrl(): string {
  const explicit = (process.env.DIRECTUS_GRAPHQL_URL || '').trim()
  if (explicit) {
    const trimmed = explicit.replace(/\/$/, '')
    return trimmed.endsWith('/graphql') ? trimmed : `${trimmed}/graphql`
  }
  const origin = (
    process.env.DIRECTUS_URL ||
    'http://localhost:8055'
  )
    .trim()
    .replace(/\/$/, '')
  return `${origin}/graphql`
}

export function directusToken(): string {
  return (
    process.env.DIRECTUS_TOKEN ||
    process.env.DIRECTUS_STATIC_TOKEN ||
    ''
  ).trim()
}

export interface DirectusGraphqlResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

export async function directusRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  endpoint?: string,
): Promise<T> {
  const url = endpoint?.trim()
    ? endpoint.trim().replace(/\/$/, '').endsWith('/graphql')
      ? endpoint.trim().replace(/\/$/, '')
      : `${endpoint.trim().replace(/\/$/, '')}/graphql`
    : directusGraphqlUrl()
  const token = directusToken()
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  })

  const text = await response.text()
  let payload: DirectusGraphqlResponse<T>
  try {
    payload = JSON.parse(text) as DirectusGraphqlResponse<T>
  } catch {
    throw new Error(
      `Directus GraphQL HTTP ${response.status}: ${text.slice(0, 200) || '(empty body)'}`,
    )
  }
  if (!response.ok) {
    const fromBody = payload.errors?.map((error) => error.message).join('; ')
    throw new Error(fromBody || `Directus GraphQL HTTP ${response.status}`)
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '))
  }
  if (!payload.data) {
    throw new Error('Directus GraphQL response missing data')
  }
  return payload.data
}

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
