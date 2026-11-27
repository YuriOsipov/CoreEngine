/**
 * MCP request/tool limits (env-tunable).
 */

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return defaultValue
  return /^(1|true|yes|on)$/i.test(String(raw).trim())
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name])
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), min), max)
}

/** Schema / layout write tools (upsert_object_schema, update_role_layout). Default off. */
export function mcpSchemaWriteEnabled(): boolean {
  return envFlag('MCP_SCHEMA_WRITE_ENABLED', false)
}

/** Max MCP HTTP tool invocations per user per minute. */
export function mcpRateLimitPerMinute(): number {
  return envInt('MCP_RATE_LIMIT_PER_MIN', 120, 10, 10_000)
}

/** Cap for query_records limit argument. */
export function mcpQueryMaxLimit(): number {
  return envInt('MCP_QUERY_MAX_LIMIT', 50, 1, 200)
}
