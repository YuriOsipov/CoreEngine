export type FilterValueKind = 'parent' | 'source' | 'literal'

/** One filter condition used by Related Transfer / Child Lookup builders. */
export interface FilterPair {
  /** Field on the filtered (child / source) collection. */
  sourceField: string
  /**
   * Parent/source field path when {@link valueKind} is `parent` or `source`.
   * Legacy pairs only set this + implicit `_eq` / `$parent.*`.
   */
  filterField: string
  /** Comparison operator. Defaults to `_eq`. */
  operator?: string
  /** Where the right-hand value comes from. Defaults to `parent`. */
  valueKind?: FilterValueKind
  /** Literal RHS when {@link valueKind} is `literal`. */
  literalValue?: string
}

const NO_VALUE_OPERATORS = new Set(['_null', '_nnull'])

export function isNoValueFilterOperator(operator: string): boolean {
  return NO_VALUE_OPERATORS.has(operator)
}

export function filterPairsFromFilter(
  filter: Record<string, unknown> | null | undefined,
): FilterPair[] {
  if (!filter) return []

  const entries = flattenFilterEntries(filter)
  return entries.reduce<FilterPair[]>((pairs, [sourceField, condition]) => {
    const parsed = parseCondition(condition)
    if (!parsed) return pairs
    pairs.push({
      sourceField,
      filterField: parsed.filterField,
      operator: parsed.operator,
      valueKind: parsed.valueKind,
      literalValue: parsed.literalValue,
    })
    return pairs
  }, [])
}

export function filterFromPairs(pairs: FilterPair[]): Record<string, unknown> | null {
  const filter = pairs.reduce<Record<string, unknown>>((result, pair) => {
    const condition = conditionFromPair(pair)
    if (pair.sourceField && condition) {
      result[pair.sourceField] = condition
    }
    return result
  }, {})

  return Object.keys(filter).length > 0 ? filter : null
}

export function parentTokenField(condition: unknown): string {
  const parsed = parseCondition(condition)
  return parsed?.valueKind === 'parent' ? parsed.filterField : ''
}

export function stripFilterPairs(
  filter: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!filter) return null
  const result = { ...filter }
  for (const [field, condition] of Object.entries(result)) {
    if (parseCondition(condition)) {
      delete result[field]
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

export function mergeAutomaticFilter(
  automaticFilter: Record<string, unknown> | null,
  extraFilter: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const cleanExtraFilter = stripAutomaticFilter(extraFilter, automaticFilter)
  if (!automaticFilter) return cleanExtraFilter
  if (!cleanExtraFilter) return automaticFilter
  return {
    ...cleanExtraFilter,
    ...automaticFilter,
  }
}

export function stripAutomaticFilter(
  filter: Record<string, unknown> | null | undefined,
  automaticFilter: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!filter || !automaticFilter) return filter ?? null
  const [automaticField, automaticValue] = Object.entries(automaticFilter)[0] ?? []
  if (!automaticField) return filter

  const result = { ...filter }
  if (sameFilterValue(result[automaticField], automaticValue)) {
    delete result[automaticField]
  }

  if (Array.isArray(result._and)) {
    const items = result._and
      .map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? stripAutomaticFilter(item as Record<string, unknown>, automaticFilter)
          : item,
      )
      .filter((item) => !isEmptyFilter(item))

    if (items.length > 0) {
      result._and = items
    } else {
      delete result._and
    }
  }

  return Object.keys(result).length > 0 ? result : null
}

function conditionFromPair(pair: FilterPair): Record<string, unknown> | null {
  const operator = pair.operator || '_eq'
  if (isNoValueFilterOperator(operator)) {
    return { [operator]: true }
  }

  const kind = pair.valueKind || 'parent'
  if (kind === 'literal') {
    if (pair.literalValue === undefined || pair.literalValue === '') return null
    return { [operator]: coerceLiteral(pair.literalValue) }
  }

  if (!pair.filterField) return null
  const prefix = kind === 'source' ? '$source.' : '$parent.'
  return { [operator]: `${prefix}${pair.filterField}` }
}

function parseCondition(condition: unknown): {
  operator: string
  valueKind: FilterValueKind
  filterField: string
  literalValue?: string
} | null {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return null
  const body = condition as Record<string, unknown>
  const operator = Object.keys(body).find((key) => key.startsWith('_'))
  if (!operator) return null

  if (isNoValueFilterOperator(operator)) {
    return { operator, valueKind: 'literal', filterField: '', literalValue: '' }
  }

  const raw = body[operator]
  if (typeof raw === 'string') {
    if (raw.startsWith('$parent.')) {
      return {
        operator,
        valueKind: 'parent',
        filterField: raw.slice('$parent.'.length),
      }
    }
    if (raw.startsWith('$source.')) {
      return {
        operator,
        valueKind: 'source',
        filterField: raw.slice('$source.'.length),
      }
    }
    return {
      operator,
      valueKind: 'literal',
      filterField: '',
      literalValue: raw,
    }
  }

  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return {
      operator,
      valueKind: 'literal',
      filterField: '',
      literalValue: String(raw),
    }
  }

  return null
}

function flattenFilterEntries(
  filter: Record<string, unknown>,
): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(filter)) {
    if (key === '_and' && Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          entries.push(...flattenFilterEntries(item as Record<string, unknown>))
        }
      }
      continue
    }
    if (key.startsWith('_')) continue
    entries.push([key, value])
  }
  return entries
}

function coerceLiteral(raw: string): string | number | boolean {
  const trimmed = raw.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  return raw
}

function sameFilterValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isEmptyFilter(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0,
  )
}
