import { evaluateComputedTemplate } from './computedTemplate.js'
import {
  collectNestedRootFieldsFromTemplates,
  hydrateM2OContext,
} from './hydrateM2OContext.js'
import {
  loadEntityFieldMeta,
  loadFormulaFields,
  resolveComputeMode,
} from './fieldMeta.js'

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** Remove client-supplied rollup values — server owns persistence. */
export async function stripRollupWrites(
  entityApiName: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = await loadEntityFieldMeta(entityApiName)
  const next = { ...patch }
  for (const field of fields) {
    if (resolveComputeMode(field.options, field.interface) === 'rollup') {
      delete next[field.apiName]
    }
  }
  return next
}

/**
 * Evaluate same-record formulas against the merged record and write results
 * into the patch (overwriting any client values for formula fields).
 */
export async function applyFormulasOnWrite(
  entityApiName: string,
  patch: Record<string, unknown>,
  existing?: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const formulas = await loadFormulaFields(entityApiName)
  if (!formulas.length) return { ...patch }

  const fieldMeta = await loadEntityFieldMeta(entityApiName)
  const typeByName = new Map(
    fieldMeta.map((field) => [field.apiName, field.fieldType.toUpperCase()]),
  )

  const next = { ...patch }
  let merged: Record<string, unknown> = {
    ...asObject(existing),
    ...next,
  }

  const nestedRoots = collectNestedRootFieldsFromTemplates(
    formulas.map((field) => field.template),
  )
  if (nestedRoots.size > 0) {
    merged = await hydrateM2OContext(entityApiName, merged, nestedRoots)
  }

  // Multi-pass so formula A can depend on formula B when ordered either way.
  for (let pass = 0; pass < formulas.length; pass += 1) {
    let changed = false
    for (const field of formulas) {
      const result = coerceFormulaResult(
        evaluateComputedTemplate(field.template, merged),
        typeByName.get(field.apiName),
      )
      if (result === '' || result === null || result === undefined) {
        if (merged[field.apiName] !== null) {
          merged[field.apiName] = null
          next[field.apiName] = null
          changed = true
        }
        continue
      }
      if (formulaResultsEqual(merged[field.apiName], result)) {
        // Normalize stored type (e.g. "15" → 15) when values match numerically.
        if (!Object.is(merged[field.apiName], result)) {
          merged[field.apiName] = result
          next[field.apiName] = result
          changed = true
        }
        continue
      }
      merged[field.apiName] = result
      next[field.apiName] = result
      changed = true
    }
    if (!changed) break
  }

  return next
}

function formulaResultsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  const leftNum = Number(left)
  const rightNum = Number(right)
  if (
    left !== '' &&
    right !== '' &&
    left != null &&
    right != null &&
    Number.isFinite(leftNum) &&
    Number.isFinite(rightNum)
  ) {
    return leftNum === rightNum
  }
  return false
}

function coerceFormulaResult(
  result: unknown,
  fieldType: string | undefined,
): unknown {
  if (result === '' || result === null || result === undefined) return result
  const type = String(fieldType || '').toUpperCase()
  if (type === 'FLOAT' || type === 'INTEGER' || type === 'DECIMAL') {
    const num = Number(result)
    if (!Number.isFinite(num)) return null
    return type === 'INTEGER' ? Math.trunc(num) : num
  }
  return result
}
