/**
 * Thin PostgREST client for the Supabase registry (Kong `/rest/v1`).
 * Opt-in via `VITE_REGISTRY_SOURCE=rest` — BFF GraphQL remains the default.
 */

export class SupabaseRestError extends Error {
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'SupabaseRestError'
    this.status = status
    this.body = body
  }
}

export function getSupabaseRestConfig(): {
  baseUrl: string
  anonKey: string
} | null {
  const baseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/$/, '')
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  if (!baseUrl || !anonKey) return null
  return { baseUrl, anonKey }
}

export function canUseSupabaseRest(): boolean {
  return getSupabaseRestConfig() !== null
}

export async function supabaseRestGet<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const config = getSupabaseRestConfig()
  if (!config) {
    throw new Error(
      'Supabase REST is not configured (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)',
    )
  }

  const url = new URL(`${config.baseUrl}/rest/v1/${path.replace(/^\//, '')}`)
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    url.searchParams.set(key, String(value))
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      Accept: 'application/json',
    },
  })

  const body = await response.text()
  if (!response.ok) {
    throw new SupabaseRestError(
      `PostgREST ${response.status} for ${path}`,
      response.status,
      body,
    )
  }

  if (!body) return [] as T
  return JSON.parse(body) as T
}
