import { hasAppPresets, postgresListPresets } from './postgresPresets.js'

interface ListPresetsOptions {
  fields: string[]
  filter?: Record<string, unknown> | null
  sort?: string[] | null
  limit?: number
}

/**
 * Supabase `app_presets` only (legacy HTTP fallback retired in the live BFF).
 */
export async function listPresets(
  options: ListPresetsOptions,
): Promise<Record<string, unknown>[]> {
  if (!(await hasAppPresets())) return []
  return postgresListPresets(options)
}
