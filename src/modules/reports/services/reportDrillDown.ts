import { getPathValue } from '@/modules/entities/utils/recordDisplay'
import type {
  ReportPivotDimension,
  ReportPivotDrillDown,
  ReportPivotPathSegment,
  ReportPivotSettings,
} from './reportSettings'
import { pivotDimensionFields } from './reportSettings'
import {
  CRM_RECORD_ID_FIELD,
  dimensionDisplayValue,
} from './reportVTableAdapter'

export function resolveDrillDownRows(
  rows: Record<string, unknown>[],
  drillDown: ReportPivotDrillDown,
): Record<string, unknown>[] {
  if (drillDown.recordIds.length > 0) {
    const idSet = new Set(drillDown.recordIds.map((id) => String(id)))
    return rows.filter((row) => {
      const id = row.id ?? row[CRM_RECORD_ID_FIELD]
      return id !== null && id !== undefined && idSet.has(String(id))
    })
  }

  return filterRowsForPivotCell(rows, drillDown.rowPath, drillDown.columnPath)
}

export function filterRowsForPivotCell(
  rows: Record<string, unknown>[],
  rowPath: ReportPivotPathSegment[],
  columnPath: ReportPivotPathSegment[],
  emptyLabel = '(empty)',
): Record<string, unknown>[] {
  const segments = [...rowPath, ...columnPath]
  if (segments.length === 0) return rows

  return rows.filter((row) =>
    segments.every((segment) =>
      dimensionDisplayValue(
        getPathValue(row, segment.field),
        emptyLabel,
        segment.dateGrain,
      ) === segment.value,
    ),
  )
}

export function buildDrillDownFromPaths(
  pivot: ReportPivotSettings,
  rowValues: string[],
  columnValues: string[],
  recordIds: Array<string | number>,
  totalLabel: string,
): ReportPivotDrillDown | null {
  // Totals are drillable: keep non-total path segments (e.g. row Total → filter by columns only).
  const rowPath = zipPath(
    pivot.rows ?? [],
    rowValues.filter((value) => value !== totalLabel),
  ) ?? []
  const columnPath = zipPath(
    pivot.columns ?? [],
    columnValues.filter((value) => value !== totalLabel),
  ) ?? []

  if (recordIds.length === 0 && rowPath.length === 0 && columnPath.length === 0) {
    return null
  }

  return {
    rowPath,
    columnPath,
    recordIds,
  }
}

/** Synthetic first column: collection Display Template label (linked to the record). */
export const DRILL_DOWN_RECORD_COLUMN = '__crmRecordLabel'

export function drillDownColumnFields(pivot: ReportPivotSettings): string[] {
  const fields = [
    DRILL_DOWN_RECORD_COLUMN,
    ...pivotDimensionFields(pivot.rows),
    ...pivotDimensionFields(pivot.columns),
    ...pivot.values.map((value) => value.field).filter((field) => field && field !== '*'),
  ]
  return Array.from(new Set(fields))
}

function zipPath(
  dimensions: ReportPivotDimension[],
  values: string[],
): ReportPivotPathSegment[] | null {
  if (dimensions.length === 0) return []
  if (values.length === 0) return null
  const count = Math.min(dimensions.length, values.length)
  return dimensions.slice(0, count).map((dimension, index) => ({
    field: dimension.field,
    value: values[index] ?? '',
    dateGrain: dimension.dateGrain ?? null,
  }))
}
