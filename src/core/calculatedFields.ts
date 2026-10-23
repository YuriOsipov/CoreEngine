import type { FieldDefinition } from '@/interfaces'
import {
  evaluateComputedTemplate,
  extractTemplateFieldPaths,
  extractTemplateFieldRefs,
} from '@/core/computedTemplate'
import {
  isCalculatedFieldInterface,
  isFieldReadonly,
  normalizeSpecial,
} from '@/modules/entities/utils/fieldMapper'

/**
 * M2O/M2M/O2M/file fields store a related-record *display* template in
 * `options.template`. That must not be treated as a computed formula — otherwise
 * list/form runtime evaluates `{{name}}` (etc.) against the parent row and
 * overwrites the expanded relation cell (e.g. Facility → "VS0086--- Draft").
 */
function isRelationLabelTemplateField(field: FieldDefinition): boolean {
  const special = normalizeSpecial(field.meta?.special)
  if (
    special.some((value) =>
      ['m2o', 'm2m', 'o2m', 'file', 'files'].includes(value),
    )
  ) {
    return true
  }

  const iface = String(field.meta?.interface ?? '').toLowerCase()
  return (
    iface.includes('m2o') ||
    iface.includes('m2m') ||
    iface.includes('many-to-one') ||
    iface.includes('one-to-many') ||
    iface.includes('list-m2m') ||
    iface.includes('file') ||
    iface.includes('files')
  )
}

export function extractFieldFormula(
  field: FieldDefinition,
): string | null {
  if (isRelationLabelTemplateField(field)) return null

  const readTemplate = (source: Record<string, unknown> | null | undefined): string | null => {
    if (!source) return null
    for (const key of ['template', 'formula', 'expression', 'compute']) {
      const value = source[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    return null
  }

  const options = field.meta?.options
  if (options && typeof options === 'object') {
    const mode = String(
      (options as Record<string, unknown>).computeMode ??
        (options as Record<string, unknown>).compute_mode ??
        '',
    )
      .trim()
      .toLowerCase()
    if (mode === 'rollup') return null
    const fromOptions = readTemplate(options as Record<string, unknown>)
    if (fromOptions) return fromOptions
  }

  const displayOptions = field.meta?.display_options
  if (displayOptions && typeof displayOptions === 'object') {
    const fromDisplay = readTemplate(displayOptions as Record<string, unknown>)
    if (fromDisplay) return fromDisplay
  }

  return null
}

export function isRollupField(field: FieldDefinition): boolean {
  const options = field.meta?.options
  if (!options || typeof options !== 'object') return false
  const record = options as Record<string, unknown>
  const mode = String(record.computeMode ?? record.compute_mode ?? '')
    .trim()
    .toLowerCase()
  if (mode === 'rollup') return true
  return Boolean(record.rollup && typeof record.rollup === 'object')
}

function inferLineTotalFormula(fieldName: string): string | null {
  const normalized = fieldName.toLowerCase()
  if (!['total', 'amount', 'line_total', 'subtotal'].includes(normalized)) {
    return null
  }
  return '{{ MULTIPLY(price, quantity) }}'
}

export function inferLineTotalFormulaForCollection(
  fieldName: string,
  fieldNames: Iterable<string>,
): string | null {
  const normalized = fieldName.toLowerCase()
  if (!['total', 'amount', 'line_total', 'subtotal'].includes(normalized)) {
    return null
  }

  const names = new Set(fieldNames)
  if (!names.has('price')) return null
  const qtyField = ['quantity', 'qty'].find((name) => names.has(name))
  if (!qtyField) return null
  return `{{ MULTIPLY(price, ${qtyField}) }}`
}

function isFormulaEligibleField(field: FieldDefinition): boolean {
  if (field.meta?.readonly === true) return true
  if (isCalculatedFieldInterface(field.meta?.interface)) return true
  return false
}

function isNumericFieldType(type: string): boolean {
  return ['float', 'decimal', 'integer', 'bigInteger', 'number'].includes(type)
}

function inferFormulaForField(
  field: FieldDefinition,
  collectionFieldNames?: Iterable<string>,
): string | null {
  if (!isFormulaEligibleField(field)) return null
  if (!isNumericFieldType(field.type)) return null

  if (collectionFieldNames) {
    return inferLineTotalFormulaForCollection(field.field, collectionFieldNames)
  }
  return inferLineTotalFormula(field.field)
}

function probeRecordForFormula(formula: string): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const ref of extractTemplateFieldRefs(formula)) {
    record[ref] = 1
  }
  return record
}

export function canEvaluateFieldFormula(formula: string): boolean {
  if (!formula.trim()) return false
  return evaluateFieldFormula(formula, probeRecordForFormula(formula)) !== null
}

export function resolveFieldFormula(
  field: FieldDefinition,
  collectionFieldNames?: Iterable<string>,
): string | null {
  const explicit = extractFieldFormula(field)
  if (explicit) {
    if (canEvaluateFieldFormula(explicit)) return explicit
    return inferFormulaForField(field, collectionFieldNames) ?? explicit
  }

  return inferFormulaForField(field, collectionFieldNames)
}

/** Readonly / computed fields must not be PATCHed — server hooks own the value. */
export function isBackendComputedField(field: FieldDefinition): boolean {
  if (isRollupField(field)) return true
  if (!isFieldReadonly(field)) return false
  if (isCalculatedFieldInterface(field.meta?.interface)) return true
  if (extractFieldFormula(field)) return true
  return true
}

export function isFormCalculatedField(
  field: FieldDefinition,
): boolean {
  if (isCalculatedFieldInterface(field.meta?.interface)) return true
  return resolveFieldFormula(field) !== null
}

export function resolveFormulaFieldValue(
  record: Record<string, unknown>,
  path: string,
): unknown {
  const segments = path.split('.')
  let current: unknown = record
  for (const segment of segments) {
    if (current === null || current === undefined) return null
    if (typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function coerceFormulaNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Unique field paths referenced in a formula/template string. */
export function extractFormulaFieldRefs(formula: string): string[] {
  return extractTemplateFieldRefs(formula)
}

export function collectFormulaDependencies(
  formulas: Record<string, string>,
): string[] {
  const deps = new Set<string>()
  for (const formula of Object.values(formulas)) {
    for (const ref of extractFormulaFieldRefs(formula)) {
      deps.add(ref)
    }
  }
  return Array.from(deps)
}

/**
 * GraphQL/select paths needed to evaluate formulas on list rows, including
 * nested M2O leaves (`item.base_price`) and their relation ids.
 */
export function collectFormulaRequestPaths(
  formulas: Record<string, string>,
): string[] {
  const paths = new Set<string>()
  for (const formula of Object.values(formulas)) {
    for (const path of extractTemplateFieldPaths(formula)) {
      paths.add(path)
      const segments = path.split('.')
      if (segments.length > 1) {
        paths.add(`${segments[0]}.id`)
      }
    }
  }
  return Array.from(paths)
}

/** Resolve explicit/inferred formulas for every non-relation field on a collection. */
export function resolveCollectionFormulas(
  fields: FieldDefinition[],
): Record<string, string> {
  const fieldNames = fields.map((item) => item.field)
  const formulas: Record<string, string> = {}
  for (const definition of fields) {
    const formula = resolveFieldFormula(definition, fieldNames)
    if (formula) formulas[definition.field] = formula
  }
  return formulas
}

export function isFormulaInputPresent(record: Record<string, unknown>, ref: string): boolean {
  const value = resolveFormulaFieldValue(record, ref)
  return value !== null && value !== undefined && value !== ''
}

/** True when every referenced field has a value on the record (any type). */
export function areFormulaInputsPresent(
  record: Record<string, unknown>,
  refs: string[],
): boolean {
  if (refs.length === 0) return false
  return refs.every((ref) => isFormulaInputPresent(record, ref))
}

/** True when every formula input has a coercible numeric value in the record. */
export function areFormulaInputsReady(
  record: Record<string, unknown>,
  refs: string[],
): boolean {
  if (refs.length === 0) return false

  return refs.every((ref) => {
    const value = resolveFormulaFieldValue(record, ref)
    return coerceFormulaNumber(value) !== null
  })
}

function formulaValuesEqual(left: unknown, right: unknown): boolean {
  const leftNumber = coerceFormulaNumber(left)
  const rightNumber = coerceFormulaNumber(right)
  if (leftNumber !== null && rightNumber !== null) {
    return Math.abs(leftNumber - rightNumber) < 1e-9
  }
  return Object.is(left, right)
}

export function evaluateFieldFormula(
  formula: string,
  record: Record<string, unknown>,
): unknown {
  if (!formula.trim()) return null

  const result = evaluateComputedTemplate(formula, record)
  if (result === '' || result === null || result === undefined) return null
  if (typeof result === 'number' && !Number.isFinite(result)) return null
  return result
}

export function applyCalculatedFields(
  record: Record<string, unknown>,
  formulas: Record<string, string>,
): Record<string, unknown> {
  let next: Record<string, unknown> | null = null

  for (const [field, formula] of Object.entries(formulas)) {
    const calculated = evaluateFieldFormula(formula, next ?? record)
    if (calculated === null) continue
    if (formulaValuesEqual((next ?? record)[field], calculated)) continue
    if (!next) next = { ...record }
    next[field] = calculated
  }

  return next ?? record
}

export { formulaValuesEqual }
