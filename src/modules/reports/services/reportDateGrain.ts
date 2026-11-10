import { formatDateValue, toDate } from '@/core/dateFormatting'

export type ReportDateGrain = 'day' | 'week' | 'month' | 'quarter' | 'year'

const DATE_GRAINS: ReportDateGrain[] = ['day', 'week', 'month', 'quarter', 'year']

export function isReportDateFieldType(
  type: string | undefined,
  component?: string,
): boolean {
  const normalized = String(type ?? '').toLowerCase()
  if (
    normalized === 'date' ||
    normalized === 'datetime' ||
    normalized === 'timestamp'
  ) {
    return true
  }
  return component === 'DatePicker' || component === 'Calendar'
}

export function normalizePivotDateGrain(value: unknown): ReportDateGrain | null {
  return DATE_GRAINS.includes(value as ReportDateGrain)
    ? (value as ReportDateGrain)
    : null
}

export function defaultDateGrainForField(
  type: string | undefined,
  component?: string,
): ReportDateGrain | null {
  return isReportDateFieldType(type, component) ? 'month' : null
}

/** Bucket a date/datetime value for pivot grouping. Returns null when grain is unset. */
export function formatReportDateGrain(
  value: unknown,
  grain: ReportDateGrain | null | undefined,
): string | null {
  if (!grain) return null
  if (value === null || value === undefined || value === '') return null

  const wall = wallClockDate(value)
  if (!wall) return null

  const year = wall.getFullYear()
  const month = wall.getMonth() + 1

  switch (grain) {
    case 'year':
      return String(year)
    case 'quarter':
      return `${year} Q${Math.floor((month - 1) / 3) + 1}`
    case 'month':
      return `${year}-${String(month).padStart(2, '0')}`
    case 'week':
      return isoWeekLabel(wall)
    case 'day':
      return `${year}-${String(month).padStart(2, '0')}-${String(wall.getDate()).padStart(2, '0')}`
    default:
      return null
  }
}

function wallClockDate(value: unknown): Date | null {
  // Prefer org-timezone wall date via formatDateValue, then parse as local Y-M-D.
  const day = formatDateValue(value, 'yyyy-MM-dd')
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return toDate(value)
}

/** ISO week label: YYYY-Www (week-year may differ from calendar year). */
function isoWeekLabel(date: Date): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}
