import type {
  FilterLogic,
  ListFilterCondition,
} from '@/modules/config/services/listFilterSettings'
import {
  listFilterableFields,
  resolveConditionFieldWidth,
} from '@/modules/config/services/listFilterSettings'
import {
  isDynamicFilterValue,
  resolveDynamicFilterValue,
  resolveDynamicFilterValueForField,
} from '@/core/dynamicFilterValues'
import {
  formatLocalDate,
  formatLocalizedDate,
  formatLocalizedDateTime,
  toDate,
} from '@/core/dateFormatting'
import { isDynamicPicklistSource } from '@/core/dynamicPicklist'

/** DocEngine `$payload.meta.filter`: `{ "Date Visit Start": value, ... }`. */
export type ListFilterMetaBlock = Record<string, unknown>

export interface ListFilterConditionInput {
  field: string
  operator: string
  value: unknown
  type?: string
}

const OPERATOR_LABELS: Record<string, string> = {
  _eq: 'Equals',
  _neq: 'Not equals',
  _contains: 'Contains',
  _gt: 'Greater than',
  _gte: 'Greater or equal',
  _lt: 'Less than',
  _lte: 'Less or equal',
  _null: 'Is empty',
  _nnull: 'Is not empty',
}

export function isUserVisibleCondition(condition: ListFilterCondition): boolean {
  return condition.userVisible !== false
}

export function filterOperatorLabel(operator: string): string {
  return OPERATOR_LABELS[operator] ?? operator
}

const NO_VALUE_OPERATORS = new Set(['_null', '_nnull'])

/** Empty select/FK values that must not become query predicates. */
export function isEmptyFilterValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  if (typeof value === 'number' && Number.isNaN(value)) return true
  return false
}

export function isApplicableFilterCondition(
  condition: ListFilterConditionInput,
): boolean {
  if (NO_VALUE_OPERATORS.has(condition.operator)) return true
  return !isEmptyFilterValue(condition.value)
}

function isDateLikeFieldType(type: string | undefined): boolean {
  const normalized = type?.toLowerCase()
  return normalized === 'date' || normalized === 'timestamp' || normalized === 'datetime'
}

function looksLikeDateValue(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())
}

function isNumericFieldType(type: string | undefined): boolean {
  return Boolean(
    type && ['integer', 'bigInteger', 'float', 'decimal'].includes(type),
  )
}

export function normalizeConditionValue(condition: ListFilterConditionInput): unknown {
  if (condition.operator === '_null') return true
  if (condition.operator === '_nnull') return true
  if (isDynamicFilterValue(condition.value)) return condition.value
  // Number(null) === 0 — never coerce empty select/FK values into a real predicate.
  if (isEmptyFilterValue(condition.value)) return null
  if (isNumericFieldType(condition.type)) {
    const numeric = Number(condition.value)
    return Number.isNaN(numeric) ? condition.value : numeric
  }
  if (
    condition.value instanceof Date ||
    isDateLikeFieldType(condition.type) ||
    looksLikeDateValue(condition.value)
  ) {
    const date = toDate(condition.value)
    if (date) {
      return condition.type?.toLowerCase() === 'date'
        ? formatLocalDate(date)
        : date.toISOString()
    }
  }
  return condition.value
}

function resolveConditionValueForQuery(condition: ListFilterConditionInput): unknown {
  return resolveDynamicFilterValueForField(condition.value, condition.type)
}

function resolveConditionValueForUi(condition: ListFilterCondition): unknown {
  if (isDynamicFilterValue(condition.value)) {
    return resolveDynamicFilterValue(condition.value)
  }
  // Normalize persisted date strings to Date so DatePicker mount does not rewrite draft.
  if (isDateLikeFieldType(condition.type) || looksLikeDateValue(condition.value)) {
    return toDate(condition.value) ?? condition.value
  }
  return condition.value
}

export function buildListFilter(
  conditions: ListFilterConditionInput[],
  logic: FilterLogic,
): Record<string, unknown> {
  const filters = conditions
    .filter(isApplicableFilterCondition)
    .map((condition) => ({
      [condition.field]: {
        [condition.operator]: normalizeConditionValue({
          ...condition,
          value: resolveConditionValueForQuery(condition),
        }),
      },
    }))

  if (filters.length === 0) return {}
  if (filters.length === 1) return filters[0]

  return {
    [logic === 'and' ? '_and' : '_or']: filters,
  }
}

export function seedRuntimeFilterValues(
  conditions: ListFilterCondition[],
): Record<string, unknown> {
  return Object.fromEntries(
    conditions
      .filter(isUserVisibleCondition)
      .map((condition) => [
        condition.id,
        resolveConditionValueForUi(condition),
      ]),
  )
}

export function resolveFilterConditionValue(
  values: Record<string, unknown>,
  conditionId: string,
  fallback: unknown,
): unknown {
  return Object.prototype.hasOwnProperty.call(values, conditionId)
    ? values[conditionId]
    : fallback
}

export function conditionFieldSpanStyle(
  condition: Pick<ListFilterCondition, 'fieldWidth'>,
): Record<string, string> {
  const span = resolveConditionFieldWidth(condition.fieldWidth)
  return { gridColumn: `span ${span}` }
}

/** Dynamic picklists store free text, so filters edit the value directly. */
export function resolveFilterValueComponent(
  component: string,
  runtimeProps: Record<string, unknown> | undefined,
): string {
  if (
    (component === 'Select' || component === 'Dropdown') &&
    isDynamicPicklistSource(runtimeProps?.choiceSource)
  ) {
    return 'InputText'
  }
  return component
}

export function filterConditionComponentProps(
  condition: { field: string; component: string },
  runtimeFieldProps: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...(runtimeFieldProps[condition.field] ?? {}),
    fluid: true,
  }

  if (isDynamicPicklistSource(base.choiceSource)) {
    delete base.choiceSource
    delete base.options
    delete base.optionLabel
    delete base.optionValue
    delete base.placeholder
  }

  if (condition.component === 'AutoComplete') {
    delete base.suggestions
    delete base.optionValue
    base.showClear = true
  }

  if (condition.component === 'Select' || condition.component === 'Dropdown') {
    base.showClear = true
  }

  return base
}

export function isAutoCompleteFilterComponent(component: string): boolean {
  return component === 'AutoComplete'
}

export function isSelectFilterComponent(component: string): boolean {
  return component === 'Select' || component === 'Dropdown'
}

/**
 * Serialize filter values for document meta so dates match the interactive
 * list filter UI (local wall-clock), not UTC ISO.
 */
function serializeFilterMetaValue(value: unknown, fieldType?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => serializeFilterMetaValue(entry, fieldType))
  }
  if (value === null || value === undefined || value === '') return value ?? null

  const type = fieldType?.toLowerCase()
  const isDateType =
    type === 'date' ||
    type === 'datetime' ||
    type === 'timestamp' ||
    value instanceof Date ||
    (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim()))

  if (isDateType && toDate(value)) {
    if (type === 'date' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()))) {
      return formatLocalizedDate(value)
    }
    return formatLocalizedDateTime(value, { includeSeconds: false })
  }

  return value
}

/**
 * Builds `$payload.meta.filter` as `{ "<Field label>": value }` for list Document reports.
 * Keys use the filter field label (e.g. "Date Visit Start"); values are interactive / saved values.
 */
export async function buildListFilterMetaBlock(
  collection: string,
  conditions: ListFilterCondition[],
  options: { resolveDynamicValues?: boolean } = {},
): Promise<ListFilterMetaBlock> {
  if (!collection || conditions.length === 0) return {}

  let labelsByField = new Map<string, string>()
  try {
    const fields = await listFilterableFields(collection)
    labelsByField = new Map(fields.map((field) => [field.field, field.label]))
  } catch {
    labelsByField = new Map()
  }

  const resolveDynamic = options.resolveDynamicValues !== false
  const block: ListFilterMetaBlock = {}
  const usedKeys = new Set<string>()

  for (const condition of conditions) {
    const field = condition.field?.trim() || ''
    if (!field) continue
    const baseLabel =
      labelsByField.get(field) ||
      field.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) ||
      field
    let key = baseLabel
    if (usedKeys.has(key)) {
      key = `${baseLabel} (${field})`
    }
    usedKeys.add(key)

    const rawValue = condition.value ?? null
    // Keep interactive Date / local strings as-is; only expand $today / $yesterday.
    const value =
      resolveDynamic && isDynamicFilterValue(rawValue)
        ? resolveDynamicFilterValueForField(rawValue, condition.type)
        : rawValue
    block[key] = serializeFilterMetaValue(value, condition.type)
  }

  return block
}

