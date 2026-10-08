export const DYNAMIC_FILTER_TOKEN_TODAY = '$today'
export const DYNAMIC_FILTER_TOKEN_YESTERDAY = '$yesterday'

export const DYNAMIC_FILTER_VALUE_TOKENS = [
  DYNAMIC_FILTER_TOKEN_TODAY,
  DYNAMIC_FILTER_TOKEN_YESTERDAY,
] as const

export type DynamicFilterValueToken = (typeof DYNAMIC_FILTER_VALUE_TOKENS)[number]

export function isDynamicFilterValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('$')
}

export function resolveDynamicFilterValue(
  value: unknown,
  referenceDate: Date = new Date(),
): Date | unknown {
  if (!isDynamicFilterValue(value)) return value

  const date = new Date(referenceDate)
  date.setHours(0, 0, 0, 0)

  switch (value) {
    case DYNAMIC_FILTER_TOKEN_TODAY:
      return date
    case DYNAMIC_FILTER_TOKEN_YESTERDAY:
      date.setDate(date.getDate() - 1)
      return date
    default:
      return value
  }
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function resolveDynamicFilterValueForField(
  value: unknown,
  fieldType?: string,
  referenceDate: Date = new Date(),
): unknown {
  if (!isDynamicFilterValue(value)) return value

  const resolved = resolveDynamicFilterValue(value, referenceDate)
  if (!(resolved instanceof Date)) return resolved

  if (fieldType === 'date') {
    return formatDateOnly(resolved)
  }

  return resolved.toISOString()
}
