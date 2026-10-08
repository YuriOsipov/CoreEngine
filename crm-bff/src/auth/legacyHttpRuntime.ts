/**
 * Cutover guard: legacy HTTP runtime must stay disabled.
 *
 * Env contract: `DIRECTUS_RUNTIME=off` (required by `registry:check-cutover`).
 * HTTP adapters were removed; this flag remains as an explicit refuse contract.
 */
export function isLegacyHttpRuntimeEnabled(): boolean {
  const value = (process.env.DIRECTUS_RUNTIME || '').trim().toUpperCase()
  if (value === 'OFF' || value === '0' || value === 'FALSE' || value === 'NO') {
    return false
  }
  return true
}

export function refuseLegacyHttpRuntime(purpose: string): never {
  throw new Error(
    `Legacy HTTP runtime was retired (DIRECTUS_RUNTIME=${isLegacyHttpRuntimeEnabled() ? 'on' : 'off'}); refused: ${purpose}`,
  )
}
