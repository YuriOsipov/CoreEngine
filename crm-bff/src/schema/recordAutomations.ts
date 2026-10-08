/**
 * Record automations — admin rules in entities.backend_config.automations.
 * Applied on create/update/delete after formulas (see applyRecordAutomations).
 */
import { query } from '../db/pool.js'

export type RecordAutomationTrigger = 'create' | 'update' | 'delete'
export type RecordAutomationLogic = 'and' | 'or'

export type RecordAutomationNotifySeverity = 'info' | 'warn'

export type RecordAutomationAction =
  | {
      type: 'notify'
      severity: RecordAutomationNotifySeverity
      message: string
    }
  | { type: 'break' }

export interface RecordAutomationCondition {
  field: string
  operator: string
  value?: unknown
  /** literal (default) | field — compare against another field on the same record */
  valueSource?: 'literal' | 'field'
  /** When valueSource=field, api_name of the other field */
  compareField?: string
}

export interface EntityRecordAutomation {
  id: string
  name: string
  enabled: boolean
  /** Lower runs first. Default 100 when omitted in stored JSON. */
  sort: number
  triggers: RecordAutomationTrigger[]
  logic: RecordAutomationLogic
  conditions: RecordAutomationCondition[]
  /** Fields that must appear in this write (and differ from existing on update). */
  requireChanged: string[]
  /** Field → value. Special: $NOW, $NULL, or {{DATE_ADD_DAYS(...)}} templates */
  setFields: Record<string, unknown>
  /** Side effects after a match (notify toast, break chain). */
  actions: RecordAutomationAction[]
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

function parseTriggers(raw: unknown): RecordAutomationTrigger[] {
  if (!Array.isArray(raw)) return ['create', 'update']
  const out: RecordAutomationTrigger[] = []
  for (const entry of raw) {
    const token = String(entry || '')
      .trim()
      .toLowerCase()
    if (token === 'create' || token === 'update' || token === 'delete') {
      if (!out.includes(token)) out.push(token)
    }
  }
  return out.length ? out : ['create', 'update']
}

function parseLogic(raw: unknown): RecordAutomationLogic {
  return String(raw || '')
    .trim()
    .toLowerCase() === 'or'
    ? 'or'
    : 'and'
}

function parseConditions(raw: unknown): RecordAutomationCondition[] {
  if (!Array.isArray(raw)) return []
  const out: RecordAutomationCondition[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const field = typeof row.field === 'string' ? row.field.trim() : ''
    const operator = typeof row.operator === 'string' ? row.operator.trim() : ''
    if (!field || !operator) continue
    const valueSourceRaw = String(
      row.valueSource ?? row.value_source ?? 'literal',
    )
      .trim()
      .toLowerCase()
    const valueSource: 'literal' | 'field' =
      valueSourceRaw === 'field' ? 'field' : 'literal'
    const compareFieldRaw =
      typeof row.compareField === 'string'
        ? row.compareField
        : typeof row.compare_field === 'string'
          ? row.compare_field
          : ''
    const compareField = compareFieldRaw.trim()
    out.push({
      field,
      operator,
      value: row.value,
      valueSource,
      ...(valueSource === 'field' && compareField
        ? { compareField }
        : {}),
    })
  }
  return out
}

function parseRequireChanged(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
}

function parseSetFields(raw: unknown): Record<string, unknown> {
  const obj = asObject(raw)
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const field = key.trim()
    if (!field) continue
    out[field] = value
  }
  return out
}

function parseActions(raw: unknown): RecordAutomationAction[] {
  if (!Array.isArray(raw)) return []
  const out: RecordAutomationAction[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const type = String(row.type || '')
      .trim()
      .toLowerCase()
    if (type === 'break') {
      out.push({ type: 'break' })
      continue
    }
    if (type === 'notify') {
      const severityRaw = String(row.severity || 'info')
        .trim()
        .toLowerCase()
      const severity: RecordAutomationNotifySeverity =
        severityRaw === 'warn' ||
        severityRaw === 'warning' ||
        severityRaw === 'alarm'
          ? 'warn'
          : 'info'
      const message = String(row.message ?? '').trim()
      if (!message) continue
      out.push({ type: 'notify', severity, message })
    }
  }
  return out
}

function ruleHasEffect(rule: {
  setFields: Record<string, unknown>
  actions: RecordAutomationAction[]
}): boolean {
  return Object.keys(rule.setFields).length > 0 || rule.actions.length > 0
}

function parseSort(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(n)) return Math.trunc(n)
  return fallback
}

/** Parse automations array from entities.backend_config. */
export function parseAutomationsFromConfig(backendConfig: unknown): EntityRecordAutomation[] {
  const config = asObject(backendConfig)
  const raw = config.automations
  if (!Array.isArray(raw)) return []
  const out: EntityRecordAutomation[] = []
  const seen = new Set<string>()
  let autoIndex = 0
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    autoIndex += 1
    const idRaw =
      typeof row.id === 'string' && row.id.trim()
        ? row.id.trim()
        : `auto_${autoIndex}`
    const id = sanitizeId(idRaw) || `auto_${autoIndex}`
    if (seen.has(id)) continue
    seen.add(id)
    const name =
      typeof row.name === 'string' && row.name.trim()
        ? row.name.trim()
        : id
    const setFields = parseSetFields(row.setFields ?? row.set_fields)
    const actions = parseActions(row.actions)
    if (!ruleHasEffect({ setFields, actions })) continue
    out.push({
      id,
      name,
      enabled: row.enabled !== false,
      sort: parseSort(row.sort, autoIndex * 10),
      triggers: parseTriggers(row.triggers),
      logic: parseLogic(row.logic),
      conditions: parseConditions(row.conditions),
      requireChanged: parseRequireChanged(
        row.requireChanged ?? row.require_changed,
      ),
      setFields,
      actions,
    })
  }
  return out.sort((left, right) => {
    if (left.sort !== right.sort) return left.sort - right.sort
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })
}

export async function loadEntityAutomations(
  entityApiName: string,
): Promise<EntityRecordAutomation[]> {
  const entities = await query<{ backend_config: unknown }>(
    `SELECT backend_config
     FROM public.entities
     WHERE api_name = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [entityApiName],
  )
  return parseAutomationsFromConfig(entities[0]?.backend_config)
}

/** Persist automations into entities.backend_config (replaces automations key only). */
export async function saveEntityAutomations(
  entityApiName: string,
  automations: EntityRecordAutomation[],
): Promise<EntityRecordAutomation[]> {
  const prepared = automations
    .map((rule, index) => ({
      id: sanitizeId(rule.id || `auto_${index + 1}`) || `auto_${index + 1}`,
      name: (rule.name || rule.id || `Rule ${index + 1}`).trim(),
      enabled: rule.enabled !== false,
      sort: parseSort(rule.sort, (index + 1) * 10),
      triggers: parseTriggers(rule.triggers),
      logic: parseLogic(rule.logic),
      conditions: parseConditions(rule.conditions),
      requireChanged: parseRequireChanged(rule.requireChanged),
      setFields: parseSetFields(rule.setFields),
      actions: parseActions(rule.actions),
    }))
    .filter((rule) => ruleHasEffect(rule))
    .sort((left, right) => {
      if (left.sort !== right.sort) return left.sort - right.sort
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    })

  const patch = JSON.stringify({ automations: prepared })
  await query(
    `UPDATE public.entities
     SET backend_config = COALESCE(backend_config, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     WHERE api_name = $1 AND deleted_at IS NULL`,
    [entityApiName, patch],
  )
  return prepared
}
