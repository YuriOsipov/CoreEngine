import type {
  EntityRecordAutomationCondition,
  LayoutGroup,
  LayoutSection,
} from '@/interfaces'
import { readPath } from '@/core/utils/object'

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

function addShowIfPaths(
  paths: Set<string>,
  conditions: EntityRecordAutomationCondition[] | null | undefined,
): void {
  for (const condition of conditions ?? []) {
    const field = String(condition?.field ?? '').trim()
    if (field) paths.add(field)
    if (condition?.valueSource === 'field') {
      const compareField = String(condition?.compareField ?? '').trim()
      if (compareField) paths.add(compareField)
    }
  }
}

/** Field paths referenced by a single condition list (show-if / readonly-if). */
export function collectConditionFieldPaths(
  conditions: EntityRecordAutomationCondition[] | null | undefined,
): string[] {
  const paths = new Set<string>()
  addShowIfPaths(paths, conditions)
  return Array.from(paths)
}

/**
 * Field paths referenced by tab/group show-if and field readonly-if conditions
 * (supports nested paths like `item.result_type`).
 */
export function collectShowIfFieldPaths(
  sections: LayoutSection[] | null | undefined,
): string[] {
  const paths = new Set<string>()
  for (const section of sections ?? []) {
    addShowIfPaths(paths, section.showIf)
    for (const group of section.groups ?? []) {
      addShowIfPaths(paths, group.showIf)
      for (const field of group.fields ?? []) {
        addShowIfPaths(paths, field.readonlyIf)
      }
    }
  }
  return Array.from(paths)
}

/** Top-level record keys needed to evaluate show-if (e.g. `item` from `item.result_type`). */
export function collectShowIfRootFields(
  sections: LayoutSection[] | null | undefined,
): string[] {
  const roots = new Set<string>()
  for (const path of collectShowIfFieldPaths(sections)) {
    const root = path.split('.').filter(Boolean)[0]
    if (root) roots.add(root)
  }
  return Array.from(roots)
}

/**
 * GraphQL/request field list for show-if paths.
 * Nested `item.result_type` also requests `item.id`.
 */
export function showIfRequestFields(paths: Iterable<string>): string[] {
  const fields = new Set<string>()
  for (const path of paths) {
    const trimmed = String(path ?? '').trim()
    if (!trimmed) continue
    fields.add(trimmed)
    const parts = trimmed.split('.').filter(Boolean)
    if (parts.length > 1) {
      fields.add(`${parts[0]}.id`)
    }
  }
  return Array.from(fields)
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

function readRecordValue(
  record: Record<string, unknown>,
  path: string,
): unknown {
  if (!path.includes('.')) {
    const direct = record[path]
    if (direct !== undefined) return direct
  }
  return readPath(record, path)
}

/** Match one field/operator/value condition against a record (form state). */
export function matchRecordCondition(
  record: Record<string, unknown>,
  condition: EntityRecordAutomationCondition,
): boolean {
  const field = String(condition.field ?? '').trim()
  if (!field) return true

  const rawFieldValue = readRecordValue(record, field)
  const fieldValue = coerceComparable(rawFieldValue)
  const op = String(condition.operator ?? '_eq').trim().toLowerCase()

  if (op === '_null' || op === 'null' || op === 'empty') {
    return isEmptyValue(rawFieldValue)
  }
  if (op === '_nnull' || op === 'nnull' || op === 'not_empty') {
    return !isEmptyValue(rawFieldValue)
  }

  const expectedRaw =
    condition.valueSource === 'field' && condition.compareField
      ? readRecordValue(record, String(condition.compareField))
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

/** Match a list of conditions with AND/OR logic. Empty list = always match. */
export function matchRecordConditions(
  record: Record<string, unknown>,
  conditions: EntityRecordAutomationCondition[] | null | undefined,
  logic: 'and' | 'or' | string | null | undefined = 'and',
): boolean {
  const list = Array.isArray(conditions)
    ? conditions.filter((condition) => String(condition?.field ?? '').trim())
    : []
  if (list.length === 0) return true
  if (logic === 'or') {
    return list.some((condition) => matchRecordCondition(record, condition))
  }
  return list.every((condition) => matchRecordCondition(record, condition))
}

/** Whether a layout tab should be shown for the given record values. */
export function isLayoutSectionVisible(
  section: LayoutSection,
  record: Record<string, unknown>,
): boolean {
  return matchRecordConditions(record, section.showIf, section.showIfLogic ?? 'and')
}

/** Whether a layout group should be shown for the given record values. */
export function isLayoutGroupVisible(
  group: LayoutGroup,
  record: Record<string, unknown>,
): boolean {
  return matchRecordConditions(record, group.showIf, group.showIfLogic ?? 'and')
}

/** Filter layout tabs by show-if conditions. */
export function filterVisibleLayoutSections(
  sections: LayoutSection[],
  record: Record<string, unknown>,
): LayoutSection[] {
  return sections.filter((section) => isLayoutSectionVisible(section, record))
}

/** Filter layout groups by show-if conditions. */
export function filterVisibleLayoutGroups(
  groups: LayoutGroup[],
  record: Record<string, unknown>,
): LayoutGroup[] {
  return groups.filter((group) => isLayoutGroupVisible(group, record))
}
