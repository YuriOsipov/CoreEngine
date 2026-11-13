/** Default timeout for IdP discovery / token HTTP calls. */
export const OIDC_FETCH_TIMEOUT_MS = 10_000

export async function fetchOidcHttp(
  url: string,
  init: RequestInit = {},
  timeoutMs = OIDC_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const signal =
    init.signal ??
    (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(timeoutMs)
      : undefined)
  return fetch(url, { ...init, signal })
}
