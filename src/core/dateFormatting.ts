import { getOrgDateFormat, getOrgDateTimeFormat, getOrgTimeZone } from '@/core/orgLocale'
import { getTranslationLanguage } from '@/core/translation'

interface DateFieldDefinition {
  type?: string
  meta?: {
    options?: Record<string, unknown> | null
    display_options?: Record<string, unknown> | null
    displayOptions?: Record<string, unknown> | null
  } | null
}

const FORMAT_TOKENS = /yyyy|YYYY|uuuu|MMMM|MMM|yy|YY|uu|y|u|MM|M|mm|m|dd|DD|d|HH|H|hh|h|ss|s|a|A/g
const DATE_FORMAT_TOKENS = /yyyy|YYYY|uuuu|MMMM|MMM|yy|YY|uu|y|u|MM|M|dd|DD|d/g

export function formatDateValue(value: unknown, format: string): string {
  const date = toDate(value)
  if (!date) return value === null || value === undefined ? '' : String(value)
  const dateOnly = isDateOnlyValue(value)
  const displayDate =
    dateOnly ? date : toZonedWallClockDate(date, getOrgTimeZone())
  const displayFormat = normalizeDateFormatForLocale(format)
  const preset = displayFormat.trim().toLowerCase()
  if (preset === 'long' || preset === 'short') {
    return formatDatePreset(displayDate, preset, dateOnly)
  }

  return displayFormat.replace(FORMAT_TOKENS, (token, index) =>
    tokenValue(displayDate, token, displayFormat, index),
  )
}

export function fieldDateDisplayFormat(
  field: DateFieldDefinition,
): string | undefined {
  const options = field.meta?.display_options ?? field.meta?.displayOptions
  const format = stringOption(options, 'format')
  if (!format) return undefined
  if (format === 'other') {
    return (
      stringOption(options, 'custom') ??
      stringOption(options, 'customFormat') ??
      stringOption(options, 'formatString')
    )
  }
  if (format === 'short' || format === 'long') {
    return fieldPresetFormat(field, format, options)
  }
  return format
}


export function effectiveDateDisplayFormat(
  format: string | null | undefined,
  field: DateFieldDefinition | undefined,
): string | undefined {
  if (format?.trim()) return format.trim()
  if (!field) return undefined
  return fieldDateDisplayFormat(field) ?? defaultFormatForDateField(field)
}

/** When Setup has no display format, still show a localized date (not raw ISO). */
function defaultFormatForDateField(field: DateFieldDefinition): string | undefined {
  const type = String(field.type ?? '').toLowerCase()
  if (type === 'date') return defaultDateDisplayFormat()
  if (type === 'time') return isUkrainianLocale() ? 'HH:mm' : 'h:mm A'
  if (type === 'datetime' || type === 'timestamp') {
    return defaultDateTimeDisplayFormat({ includeSeconds: false })
  }
  // DatePicker/Calendar layouts may omit a typed date when the column is mis-typed;
  // prefer a date-only short format over dumping the ISO string.
  if (!type || type === 'string' || type === 'text') {
    return defaultDateDisplayFormat()
  }
  return undefined
}

export function isDateComponent(component: string | undefined): boolean {
  return component === 'DatePicker' || component === 'Calendar'
}

export function defaultDateDisplayFormat(): string {
  return getOrgDateFormat() || fieldPresetDateFormat('short')
}

export function defaultDateTimeDisplayFormat(
  options: { includeSeconds?: boolean } = {},
): string {
  const orgFormat = getOrgDateTimeFormat()
  if (orgFormat) {
    if (options.includeSeconds === false) {
      return orgFormat.replace(/:?ss/gi, '').replace(/\s+/g, ' ').trim()
    }
    return orgFormat
  }
  const includeSeconds = options.includeSeconds ?? true
  const timeFormat = isUkrainianLocale()
    ? `HH:mm${includeSeconds ? ':ss' : ''}`
    : `h:mm${includeSeconds ? ':ss' : ''} A`
  return `${fieldPresetDateFormat('short')} ${timeFormat}`
}

export function formatLocalizedDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  return formatDateValue(value, defaultDateDisplayFormat())
}

export function formatLocalizedDateTime(
  value: unknown,
  options: { includeSeconds?: boolean } = {},
): string {
  if (value === null || value === undefined || value === '') return ''
  return formatDateValue(value, defaultDateTimeDisplayFormat(options))
}

export function primeVueDatePickerFormat(format: string): string {
  const dateFormat = datePartFormat(format)
  return dateFormat.replace(DATE_FORMAT_TOKENS, primeVueDateToken)
}

export function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatLocalTime(
  date: Date,
  options: { includeSeconds?: boolean } = {},
): string {
  const includeSeconds = options.includeSeconds ?? true
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  if (!includeSeconds) {
    return `${hours}:${minutes}`
  }
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

export function formatLocalDateTime(
  date: Date,
  options: { includeSeconds?: boolean } = {},
): string {
  return `${formatLocalDate(date)}T${formatLocalTime(date, options)}`
}

function isTimezonelessDateTimeString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)
}

export function serializeDateFieldValue(
  value: unknown,
  fieldType: string,
): unknown {
  if (value === null || value === undefined || value === '') return value

  if (fieldType === 'date') {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return value.trim()
    }
    const date = toDate(value)
    return date ? formatLocalDate(date) : value
  }

  if (fieldType === 'time') {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
        return trimmed.length === 5 ? `${trimmed}:00` : trimmed
      }
    }
    const date = toDate(value)
    return date ? formatLocalTime(date) : value
  }

  if (fieldType === 'dateTime') {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (isTimezonelessDateTimeString(trimmed)) {
        return trimmed.slice(0, 19)
      }
    }
    const date = toDate(value)
    return date ? formatLocalDateTime(date) : value
  }

  if (fieldType === 'timestamp') {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) {
        const date = toDate(trimmed)
        return date ? date.toISOString() : value
      }
      if (isTimezonelessDateTimeString(trimmed)) {
        const date = toDate(trimmed)
        return date ? date.toISOString() : value
      }
    }
    const date = toDate(value)
    return date ? date.toISOString() : value
  }

  return value
}

function tokenValue(date: Date, token: string, format: string, index: number): string {
  const month = date.getMonth()
  const hours = date.getHours()
  const hour12 = hours % 12 || 12

  switch (token) {
    case 'yyyy':
    case 'YYYY':
    case 'uuuu':
      return String(date.getFullYear())
    case 'yy':
    case 'YY':
    case 'uu':
      return String(date.getFullYear()).slice(-2)
    case 'y':
    case 'u':
      return String(date.getFullYear())
    case 'MMMM':
      return monthName(date, 'long')
    case 'MMM':
      return monthName(date, 'short')
    case 'MM':
      return pad(month + 1)
    case 'M':
      return String(month + 1)
    case 'mm':
      return isTimeMinuteToken(format, index) ? pad(date.getMinutes()) : pad(month + 1)
    case 'm':
      return isTimeMinuteToken(format, index) ? String(date.getMinutes()) : String(month + 1)
    case 'dd':
    case 'DD':
      return pad(date.getDate())
    case 'd':
      return String(date.getDate())
    case 'HH':
      return pad(hours)
    case 'H':
      return String(hours)
    case 'hh':
      return pad(hour12)
    case 'h':
      return String(hour12)
    case 'ss':
      return pad(date.getSeconds())
    case 's':
      return String(date.getSeconds())
    case 'a':
      return dayPeriod(date).toLowerCase()
    case 'A':
      return dayPeriod(date).toUpperCase()
    default:
      return token
  }
}

function formatDatePreset(date: Date, preset: 'long' | 'short', dateOnly: boolean): string {
  // `date` is already org wall-clock for date-times (see formatDateValue).
  if (dateOnly) {
    return date.toLocaleDateString(currentLocale(), {
      dateStyle: preset,
    })
  }

  return date.toLocaleString(currentLocale(), {
    dateStyle: preset,
    timeStyle: preset === 'long' ? 'medium' : 'short',
  })
}

/**
 * Build a Date whose local getters reflect wall-clock time in `timeZone`
 * (so existing token formatting can stay timezone-agnostic).
 */
function toZonedWallClockDate(date: Date, timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const read = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? NaN)
    const year = read('year')
    const month = read('month')
    const day = read('day')
    const hour = read('hour')
    const minute = read('minute')
    const second = read('second')
    if (
      [year, month, day, hour, minute, second].some((value) => Number.isNaN(value))
    ) {
      return date
    }
    return new Date(year, month - 1, day, hour, minute, second)
  } catch {
    return date
  }
}

function isTimeMinuteToken(format: string, index: number): boolean {
  return /[Hh]:?$/.test(format.slice(Math.max(0, index - 2), index))
}

function datePartFormat(format: string): string {
  return format.split(/\s+[Hh]/)[0] || format
}

function primeVueDateToken(token: string): string {
  switch (token) {
    case 'yyyy':
    case 'YYYY':
    case 'uuuu':
    case 'yy':
    case 'y':
    case 'u':
      return 'yy'
    case 'YY':
    case 'uu':
      return 'y'
    case 'MMMM':
      return 'MM'
    case 'MMM':
      return 'M'
    case 'MM':
      return 'mm'
    case 'M':
      return 'm'
    case 'dd':
    case 'DD':
      return 'dd'
    case 'd':
      return 'd'
    default:
      return token
  }
}

function normalizeDateFormatForLocale(format: string): string {
  if (!isUkrainianLocale() || !hasDayPeriodToken(format)) return format

  return format
    .replace(/\bhh?\b/g, 'HH')
    .replace(/\s*[aA]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasDayPeriodToken(format: string): boolean {
  return /(^|[^A-Za-z])[aA]([^A-Za-z]|$)/.test(format)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function currentLocale(): string {
  return getTranslationLanguage()
}

function monthName(date: Date, month: 'short' | 'long'): string {
  return new Intl.DateTimeFormat(currentLocale(), { month }).format(date)
}

function dayPeriod(date: Date): string {
  const parts = new Intl.DateTimeFormat(currentLocale(), {
    hour: 'numeric',
    hour12: true,
  }).formatToParts(date)
  return parts.find((part) => part.type === 'dayPeriod')?.value ?? (
    date.getHours() >= 12 ? 'PM' : 'AM'
  )
}

function isDateOnlyValue(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function fieldPresetFormat(
  field: DateFieldDefinition,
  preset: 'short' | 'long',
  displayOptions: Record<string, unknown> | null | undefined,
): string {
  const dateFormat = fieldPresetDateFormat(preset)
  if (field.type === 'date') return dateFormat

  const inputOptions = field.meta?.options
  const includeSeconds =
    booleanOption(displayOptions, 'include_seconds') ??
    booleanOption(displayOptions, 'includeSeconds') ??
    booleanOption(inputOptions, 'include_seconds') ??
    booleanOption(inputOptions, 'includeSeconds') ??
    false
  const use24Hour =
    booleanOption(displayOptions, 'use_24') ??
    booleanOption(displayOptions, 'use24') ??
    booleanOption(displayOptions, 'use24Hour') ??
    booleanOption(displayOptions, 'use24HourFormat') ??
    booleanOption(inputOptions, 'use_24') ??
    booleanOption(inputOptions, 'use24') ??
    booleanOption(inputOptions, 'use24Hour') ??
    booleanOption(inputOptions, 'use24HourFormat') ??
    isUkrainianLocale()
  const timeFormat = use24Hour
    ? `HH:mm${includeSeconds ? ':ss' : ''}`
    : `h:mm${includeSeconds ? ':ss' : ''} A`

  return `${dateFormat} ${timeFormat}`
}

function fieldPresetDateFormat(preset: 'short' | 'long'): string {
  if (isUkrainianLocale()) {
    return preset === 'short' ? 'dd.MM.yyyy' : 'd MMMM yyyy'
  }

  return preset === 'short' ? 'MMM d, y' : 'MMMM d, y'
}

function isUkrainianLocale(): boolean {
  return currentLocale().toLowerCase().startsWith('uk')
}

function booleanOption(
  options: Record<string, unknown> | null | undefined,
  key: string,
): boolean | undefined {
  const value = options?.[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string' && ['true', 'false'].includes(value)) {
    return value === 'true'
  }
  return undefined
}

function stringOption(
  options: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  const value = options?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
