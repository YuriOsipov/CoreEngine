/**
 * Apply entity record automations on create/update/delete (after formulas).
 */
import {
  loadEntityAutomations,
  type EntityRecordAutomation,
  type RecordAutomationAction,
  type RecordAutomationCondition,
  type RecordAutomationNotifySeverity,
  type RecordAutomationTrigger,
} from '../schema/recordAutomations.js'
import { evaluateComputedTemplate } from './computedTemplate.js'
import { loadM2ORelations } from '../adapters/records/relations.js'
import { resolveRecordsStore } from '../adapters/records/registry.js'

export const AUTOMATION_TOASTS_KEY = '__automationToasts'

export interface AutomationToast {
  severity: RecordAutomationNotifySeverity
  message: string
}

export interface ApplyRecordAutomationsResult {
  patch: Record<string, unknown>
  toasts: AutomationToast[]
  stopped: boolean
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (isEmptyValue(a) && isEmptyValue(b)) return true
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a)
    const nb = Number(b)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb
  }
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : Date.parse(String(a ?? ''))
    const tb = b instanceof Date ? b.getTime() : Date.parse(String(b ?? ''))
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta === tb
  }
  return String(a ?? '') === String(b ?? '')
}

function coerceComparable(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return ''
    const asNum = Number(trimmed)
    if (trimmed !== '' && Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      return asNum
    }
    const asDate = Date.parse(trimmed)
    if (Number.isFinite(asDate) && /^\d{4}-\d{2}/.test(trimmed)) return asDate
    return trimmed
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if ('id' in obj) return obj.id
  }
  return value
}

function matchCondition(
  record: Record<string, unknown>,
  condition: RecordAutomationCondition,
): boolean {
  const fieldValue = coerceComparable(record[condition.field])
  const op = condition.operator.trim().toLowerCase()

  if (op === '_null' || op === 'null' || op === 'empty') {
    return isEmptyValue(record[condition.field])
  }
  if (op === '_nnull' || op === 'nnull' || op === 'not_empty') {
    return !isEmptyValue(record[condition.field])
  }

  const expectedRaw =
    condition.valueSource === 'field' && condition.compareField
      ? record[condition.compareField]
      : condition.value
  const expected = coerceComparable(expectedRaw)

  switch (op) {
    case '_eq':
    case 'eq':
      return valuesEqual(fieldValue, expected)
    case '_neq':
    case 'neq':
      return !valuesEqual(fieldValue, expected)
    case '_contains':
    case 'contains':
      return String(fieldValue ?? '')
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase())
    case '_gt':
    case 'gt':
      return Number(fieldValue) > Number(expected)
    case '_gte':
    case 'gte':
      return Number(fieldValue) >= Number(expected)
    case '_lt':
    case 'lt':
      return Number(fieldValue) < Number(expected)
    case '_lte':
    case 'lte':
      return Number(fieldValue) <= Number(expected)
    default:
      return false
  }
}

function matchConditions(rule: EntityRecordAutomation, record: Record<string, unknown>): boolean {
  if (!rule.conditions.length) return true
  if (rule.logic === 'or') {
    return rule.conditions.some((condition) => matchCondition(record, condition))
  }
  return rule.conditions.every((condition) => matchCondition(record, condition))
}

function fieldChangedInWrite(
  field: string,
  patch: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  trigger: RecordAutomationTrigger,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(patch, field)) return false
  if (trigger === 'create') return !isEmptyValue(patch[field])
  const before = existing ? existing[field] : undefined
  return !valuesEqual(before, patch[field])
}

function matchRequireChanged(
  rule: EntityRecordAutomation,
  patch: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  trigger: RecordAutomationTrigger,
): boolean {
  if (trigger === 'delete') return true
  if (!rule.requireChanged.length) return true
  return rule.requireChanged.every((field) =>
    fieldChangedInWrite(field, patch, existing, trigger),
  )
}

function relationId(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value).trim()
    return id || null
  }
  if (typeof value === 'object' && value && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return id == null ? null : String(id)
  }
  return null
}

/** Collect M2O root fields referenced as `field.child` inside {{ templates }}. */
function collectNestedRootFields(setFields: Record<string, unknown>): Set<string> {
  const roots = new Set<string>()
  for (const raw of Object.values(setFields)) {
    if (typeof raw !== 'string') continue
    for (const match of raw.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      const expression = match[1] ?? ''
      for (const pathMatch of expression.matchAll(
        /\b([a-zA-Z_][\w]*)\.(?:[a-zA-Z_][\w.]*)/g,
      )) {
        const root = pathMatch[1]
        if (root && !root.startsWith('$')) roots.add(root)
      }
    }
  }
  return roots
}

async function hydrateM2OContext(
  entityApiName: string,
  record: Record<string, unknown>,
  roots: Set<string>,
): Promise<Record<string, unknown>> {
  if (!roots.size) return { ...record }
  const context = { ...record }
  const relations = await loadM2ORelations(entityApiName)
  const byField = new Map(relations.map((rel) => [rel.fieldApiName, rel.relatedEntityApiName]))

  for (const root of roots) {
    const relatedEntity = byField.get(root)
    if (!relatedEntity) continue
    const current = context[root]
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      const nested = current as Record<string, unknown>
      if (nested.date_start != null || Object.keys(nested).length > 1) continue
    }
    const id = relationId(current)
    if (!id) continue
    try {
      const store = await resolveRecordsStore(relatedEntity)
      context[root] = await store.findOne(relatedEntity, id, null)
    } catch {
      // Keep scalar id when related row cannot be loaded.
    }
  }
  return context
}

function resolveSetValue(
  value: unknown,
  nowIso: string,
  context: Record<string, unknown>,
): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === '$NOW' || trimmed === '{{$NOW}}') return nowIso
  if (trimmed === '$NULL' || trimmed === '{{$NULL}}') return null
  if (trimmed.includes('{{')) {
    const evaluated = evaluateComputedTemplate(trimmed, context)
    if (evaluated instanceof Date) return evaluated.toISOString()
    return evaluated === '' ? null : evaluated
  }
  return value
}

async function applyRuleSetFields(
  entityApiName: string,
  patch: Record<string, unknown>,
  setFields: Record<string, unknown>,
  nowIso: string,
  merged: Record<string, unknown>,
): Promise<void> {
  const roots = collectNestedRootFields(setFields)
  const context = await hydrateM2OContext(entityApiName, merged, roots)
  for (const [field, raw] of Object.entries(setFields)) {
    if (!field || field === 'id') continue
    const resolved = resolveSetValue(raw, nowIso, context)
    if (resolved === '' || resolved === undefined) continue
    patch[field] = resolved
    merged[field] = resolved
    context[field] = resolved
  }
}

function applyRuleActions(
  actions: RecordAutomationAction[],
  toasts: AutomationToast[],
): boolean {
  let shouldBreak = false
  for (const action of actions) {
    if (action.type === 'notify') {
      const message = action.message.trim()
      if (!message) continue
      toasts.push({
        severity: action.severity === 'warn' ? 'warn' : 'info',
        message,
      })
      continue
    }
    if (action.type === 'break') {
      shouldBreak = true
    }
  }
  return shouldBreak
}

export function attachAutomationToasts(
  record: Record<string, unknown>,
  toasts: AutomationToast[],
): Record<string, unknown> {
  if (!toasts.length) return record
  return {
    ...record,
    [AUTOMATION_TOASTS_KEY]: toasts.map((toast) => ({
      severity: toast.severity,
      message: toast.message,
    })),
  }
}

/**
 * Merge matching automation setFields into the write patch and collect toasts.
 * Conditions evaluate against existing + current patch (after formulas).
 * On delete, setFields are skipped; requireChanged is ignored.
 *
 * setFields values support $NOW, $NULL, and computed templates such as
 * {{DATE_ADD_DAYS(project.date_start, offset_days)}}.
 */
export async function applyRecordAutomations(
  entityApiName: string,
  patch: Record<string, unknown>,
  existing: Record<string, unknown> | null | undefined,
  trigger: RecordAutomationTrigger,
): Promise<ApplyRecordAutomationsResult> {
  const rules = await loadEntityAutomations(entityApiName)
  const enabled = rules.filter(
    (rule) => rule.enabled && rule.triggers.includes(trigger),
  )
  if (!enabled.length) {
    return { patch: { ...patch }, toasts: [], stopped: false }
  }

  const originalPatch = { ...patch }
  const next = { ...patch }
  const toasts: AutomationToast[] = []
  const nowIso = new Date().toISOString()
  const existingObj = existing ? asObject(existing) : null
  let stopped = false

  for (const rule of enabled) {
    if (!matchRequireChanged(rule, originalPatch, existingObj, trigger)) continue
    const merged: Record<string, unknown> = {
      ...asObject(existingObj),
      ...next,
    }
    if (!matchConditions(rule, merged)) continue
    if (trigger !== 'delete') {
      await applyRuleSetFields(entityApiName, next, rule.setFields, nowIso, merged)
    }
    const shouldBreak = applyRuleActions(rule.actions ?? [], toasts)
    if (shouldBreak) {
      stopped = true
      break
    }
  }

  return { patch: next, toasts, stopped }
}
