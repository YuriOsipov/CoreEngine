/**
 * Resolve Setup → Connections key from task / job params.
 * Prefer `connectionKey` (and `connection`); keep `flowKey` / `webhook` as aliases.
 */
export function resolveConnectionKey(
  params: Record<string, unknown>,
  fallback = '',
): string {
  for (const key of ['connectionKey', 'connection', 'flowKey', 'webhook'] as const) {
    const value = params[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}
