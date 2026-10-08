import {
  buildListFilter,
  filterOperatorLabel,
  type ListFilterConditionInput,
} from '@/core/listFilterUtils'

export type PanelFilterLogic = 'and' | 'or'

export interface PanelFilterRow {
  id: string
  field: string
  operator: string
  value: string
}

export const PANEL_FILTER_OPERATORS = [
  '_eq',
  '_neq',
  '_contains',
  '_gt',
  '_gte',
  '_lt',
  '_lte',
  '_null',
  '_nnull',
] as const

export function panelFilterOperatorOptions(): { label: string; value: string }[] {
  return PANEL_FILTER_OPERATORS.map((value) => ({
    value,
    label: filterOperatorLabel(value),
  }))
}

export function createEmptyFilterRow(): PanelFilterRow {
  return {
    id: crypto.randomUUID(),
    field: '',
    operator: '_eq',
    value: '',
  }
}

const KNOWN_OPS = new Set<string>(PANEL_FILTER_OPERATORS)

/** Flatten a Directus filter object into editable rows (best-effort). */
export function parseDirectusFilter(
  filter: Record<string, unknown> | null | undefined,
): { logic: PanelFilterLogic; rows: PanelFilterRow[] } {
  if (!filter || Object.keys(filter).length === 0) {
    return { logic: 'and', rows: [] }
  }

  if (Array.isArray(filter._and)) {
    return {
      logic: 'and',
      rows: filter._and.flatMap((entry) =>
        entry && typeof entry === 'object'
          ? rowsFromLeaf(entry as Record<string, unknown>)
          : [],
      ),
    }
  }

  if (Array.isArray(filter._or)) {
    return {
      logic: 'or',
      rows: filter._or.flatMap((entry) =>
        entry && typeof entry === 'object'
          ? rowsFromLeaf(entry as Record<string, unknown>)
          : [],
      ),
    }
  }

  return { logic: 'and', rows: rowsFromLeaf(filter) }
}

function rowsFromLeaf(node: Record<string, unknown>): PanelFilterRow[] {
  const rows: PanelFilterRow[] = []
  for (const [field, raw] of Object.entries(node)) {
    if (field === '_and' || field === '_or') continue
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const ops = raw as Record<string, unknown>
    for (const [operator, value] of Object.entries(ops)) {
      if (!KNOWN_OPS.has(operator)) continue
      rows.push({
        id: crypto.randomUUID(),
        field,
        operator,
        value:
          value === null || value === undefined || typeof value === 'boolean'
            ? ''
            : String(value),
      })
    }
  }
  return rows
}

/** Build Directus filter JSON from friendly rows. */
export function buildDirectusFilterFromRows(
  rows: PanelFilterRow[],
  logic: PanelFilterLogic,
): Record<string, unknown> {
  const conditions: ListFilterConditionInput[] = rows
    .filter((row) => row.field.trim())
    .map((row) => ({
      field: row.field.trim(),
      operator: row.operator,
      value: row.value,
    }))

  return buildListFilter(conditions, logic)
}

export function operatorNeedsValue(operator: string): boolean {
  return operator !== '_null' && operator !== '_nnull'
}
