import { getAccessToken } from '@/core/auth/session'
import { rolePreviewRequestHeaders } from '@/core/rolePreview'

const graphqlUrl =
  (import.meta.env.VITE_GRAPHQL_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:4000/graphql'

export interface GraphQlResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

export async function graphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await getAccessToken()
  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...rolePreviewRequestHeaders(),
    },
    credentials: 'include',
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`GraphQL HTTP ${response.status}`)
  }

  const payload = (await response.json()) as GraphQlResponse<T>
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '))
  }
  if (!payload.data) {
    throw new Error('GraphQL response missing data')
  }
  return payload.data
}

export { graphqlUrl }
