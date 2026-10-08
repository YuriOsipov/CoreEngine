import type { LayoutFieldMetadata } from '@/interfaces'
import {
  areFormulaInputsPresent,
  evaluateFieldFormula,
  extractFormulaFieldRefs,
  inferLineTotalFormulaForCollection,
} from '@/core/calculatedFields'

function visibleFieldNames(fields: LayoutFieldMetadata[]): Set<string> {
  return new Set(fields.map((field) => field.field))
}

/** Merge runtime formulas with optional line-total fallback for hook-only readonly fields. */
export function resolvePreviewFormulas(
  fields: LayoutFieldMetadata[],
  runtimeFormulas: Record<string, string>,
): Record<string, string> {
  const fieldNames = visibleFieldNames(fields)
  const merged = { ...runtimeFormulas }

  for (const field of fields) {
    if (merged[field.field]) continue

    const inferred = inferLineTotalFormulaForCollection(field.field, fieldNames)
    if (inferred) {
      merged[field.field] = inferred
    }
  }

  return merged
}

/** Display-only previews for computed / hook-computed fields (never written to save payload). */
export function computeFormPreviewValues(
  record: Record<string, unknown>,
  fields: LayoutFieldMetadata[],
  formulas: Record<string, string>,
): Record<string, unknown> {
  const fieldNames = visibleFieldNames(fields)
  const resolvedFormulas = resolvePreviewFormulas(fields, formulas)
  const preview: Record<string, unknown> = {}

  for (const [targetField, formula] of Object.entries(resolvedFormulas)) {
    if (!fieldNames.has(targetField)) continue

    const refs = extractFormulaFieldRefs(formula)
    if (refs.length === 0) continue
    if (!areFormulaInputsPresent(record, refs)) continue

    const result = evaluateFieldFormula(formula, record)
    if (result === null) continue

    preview[targetField] = result
  }

  return preview
}

export function hasPreviewValue(
  previewValues: Record<string, unknown>,
  fieldName: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(previewValues, fieldName)
}
