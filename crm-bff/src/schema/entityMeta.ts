import { query } from '../db/pool.js'
import { clampSensitivity } from '../services/fieldSecurity.js'
import {
  clearRowLevelSecurityCache,
  parseRowLevelSecurity,
  readRowLevelSecurity,
  type RowLevelSecurityMode,
} from '../services/rowLevelSecurity.js'

export type EntityAccountability = 'all' | 'activity' | null
export type { RowLevelSecurityMode }

export interface EntityMetaInput {
  label?: string | null
  note?: string | null
  icon?: string | null
  displayTemplate?: string | null
  hidden?: boolean | null
  singleton?: boolean | null
  /** Platform / internal object — hidden from Object Manager pickers. */
  internal?: boolean | null
  /** `all` | `activity` | null (do not track). Omit to leave unchanged. */
  accountability?: EntityAccountability | undefined
  /**
   * Default `fields.sensitivity` for new fields when create omits sensitivity
   * (0 none, 1 restricted, 2 confidential). Omit to leave unchanged.
   */
  defaultFieldSensitivity?: number | null
  /**
   * Owner row security: `"owner"` | null (off). Omit to leave unchanged.
   * Uses `user_created` as owner; admins bypass.
   */
  rowLevelSecurity?: RowLevelSecurityMode | undefined
}

export interface EntityMetaRow {
  id: string
  apiName: string
  label: string
  note: string | null
  icon: string | null
  displayTemplate: string | null
  hidden: boolean
  singleton: boolean
  internal: boolean
  accountability: EntityAccountability
  /** Applied when createRegistryField omits sensitivity. */
  defaultFieldSensitivity: number
  /** `owner` = non-admins only see / mutate their `user_created` rows. */
  rowLevelSecurity: RowLevelSecurityMode
  backendConfig: Record<string, unknown>
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export function parseAccountability(raw: unknown): EntityAccountability {
  if (raw === null || raw === 'none' || raw === '') return null
  if (raw === 'activity' || raw === 'all') return raw
  // Default when unset: track activity + revisions (Directus-like).
  return 'all'
}

export function readNote(config: Record<string, unknown>): string | null {
  const note = config.note
  if (typeof note === 'string' && note.trim()) return note.trim()
  return null
}

export function readInternal(config: Record<string, unknown>): boolean {
  return config.internal === true
}

/** Entity / pack default for new fields (backend_config.defaultFieldSensitivity). */
export function parseDefaultFieldSensitivity(raw: unknown): number {
  if (raw == null || raw === '') return 0
  return clampSensitivity(raw)
}

export function readDefaultFieldSensitivity(
  config: Record<string, unknown>,
): number {
  return parseDefaultFieldSensitivity(config.defaultFieldSensitivity)
}

export async function loadEntityMeta(entityApiName: string): Promise<EntityMetaRow | null> {
  const rows = await query(
    `SELECT id, api_name, label, icon, display_template, hidden, singleton, backend_config
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [entityApiName],
  )
  const row = rows[0]
  if (!row) return null
  const backendConfig = asObject(row.backend_config)
  return {
    id: String(row.id),
    apiName: String(row.api_name),
    label: String(row.label ?? row.api_name),
    note: readNote(backendConfig),
    icon: row.icon ? String(row.icon) : null,
    displayTemplate: row.display_template ? String(row.display_template) : null,
    hidden: Boolean(row.hidden),
    singleton: Boolean(row.singleton),
    internal: readInternal(backendConfig),
    accountability: parseAccountability(backendConfig.accountability),
    defaultFieldSensitivity: readDefaultFieldSensitivity(backendConfig),
    rowLevelSecurity: readRowLevelSecurity(backendConfig),
    backendConfig,
  }
}

export async function updateEntityMeta(
  entityApiName: string,
  input: EntityMetaInput,
): Promise<EntityMetaRow> {
  const current = await loadEntityMeta(entityApiName)
  if (!current) throw new Error(`Entity not found: ${entityApiName}`)

  const nextLabel =
    input.label !== undefined && input.label !== null
      ? String(input.label).trim() || current.label
      : current.label
  const nextIcon =
    input.icon !== undefined
      ? input.icon === null || String(input.icon).trim() === ''
        ? null
        : String(input.icon).trim()
      : current.icon
  const nextTemplate =
    input.displayTemplate !== undefined
      ? input.displayTemplate === null || String(input.displayTemplate).trim() === ''
        ? null
        : String(input.displayTemplate).trim()
      : current.displayTemplate
  const nextHidden =
    input.hidden !== undefined && input.hidden !== null
      ? Boolean(input.hidden)
      : current.hidden
  const nextSingleton =
    input.singleton !== undefined && input.singleton !== null
      ? Boolean(input.singleton)
      : current.singleton

  const configPatch: Record<string, unknown> = {}
  if (input.note !== undefined) {
    const trimmed =
      input.note === null || String(input.note).trim() === ''
        ? null
        : String(input.note).trim()
    configPatch.note = trimmed
  }
  if (input.accountability !== undefined) {
    configPatch.accountability = input.accountability
  }
  if (input.defaultFieldSensitivity !== undefined) {
    configPatch.defaultFieldSensitivity = clampSensitivity(
      input.defaultFieldSensitivity,
    )
  }
  if (input.rowLevelSecurity !== undefined) {
    // Persist explicit null as JSON null so packs/UI can turn owner mode off.
    configPatch.rowLevelSecurity = parseRowLevelSecurity(input.rowLevelSecurity)
  }
  if (input.internal !== undefined && input.internal !== null) {
    configPatch.internal = Boolean(input.internal)
  }

  const hasConfigPatch = Object.keys(configPatch).length > 0

  await query(
    `UPDATE public.entities
     SET label = $2,
         icon = $3,
         display_template = $4,
         hidden = $5,
         singleton = $6,
         backend_config = CASE
           WHEN $7::boolean THEN COALESCE(backend_config, '{}'::jsonb) || $8::jsonb
           ELSE backend_config
         END,
         updated_at = now()
     WHERE api_name = $1 AND deleted_at IS NULL`,
    [
      entityApiName,
      nextLabel,
      nextIcon,
      nextTemplate,
      nextHidden,
      nextSingleton,
      hasConfigPatch,
      JSON.stringify(configPatch),
    ],
  )

  if (input.rowLevelSecurity !== undefined) {
    clearRowLevelSecurityCache()
  }

  const updated = await loadEntityMeta(entityApiName)
  if (!updated) throw new Error(`Entity not found after update: ${entityApiName}`)
  return updated
}

/** Resolve accountability for audit writers. Missing entity → track all. */
export async function resolveEntityAccountability(
  entityApiName: string,
): Promise<EntityAccountability> {
  const meta = await loadEntityMeta(entityApiName)
  return meta?.accountability ?? 'all'
}

/** Sensitivity applied when create omits an explicit field sensitivity. */
export async function resolveEntityDefaultFieldSensitivity(
  entityApiName: string,
): Promise<number> {
  const meta = await loadEntityMeta(entityApiName)
  return meta?.defaultFieldSensitivity ?? 0
}
