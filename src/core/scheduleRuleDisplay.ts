import { t } from '@/core/translation'
import type { ScheduleRule, ScheduleRuleFrequency, ScheduleWeekParity } from '@/interfaces'

const WEEKDAY_KEYS: Record<number, [string, string]> = {
  1: ['schedule.mon', 'Mon'],
  2: ['schedule.tue', 'Tue'],
  3: ['schedule.wed', 'Wed'],
  4: ['schedule.thu', 'Thu'],
  5: ['schedule.fri', 'Fri'],
  6: ['schedule.sat', 'Sat'],
  7: ['schedule.sun', 'Sun'],
}

function toNumberList(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : []
  const nums = raw
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
  return Array.from(new Set(nums))
}

/** Parses a stored schedule-rule value (object, single-item array, or JSON string). */
export function readScheduleRule(value: unknown): ScheduleRule | null {
  let source = value
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      return null
    }
  }
  source = Array.isArray(source) ? source[0] : source
  if (!source || typeof source !== 'object') return null

  const record = source as Record<string, unknown>
  const frequency: ScheduleRuleFrequency =
    record.frequency === 'monthly' ? 'monthly' : 'weekly'
  const weekParity: ScheduleWeekParity =
    record.weekParity === 'even' || record.weekParity === 'odd'
      ? record.weekParity
      : 'all'

  return {
    frequency,
    weekParity,
    daysOfWeek: toNumberList(record.daysOfWeek),
    daysOfMonth: toNumberList(record.daysOfMonth),
    startTime: typeof record.startTime === 'string' ? record.startTime : '09:00',
    endTime: typeof record.endTime === 'string' ? record.endTime : '17:00',
  }
}

/** Human-readable summary for list/detail display of a Repeater (schedule rule) value. */
export function formatScheduleRuleSummary(value: unknown): string {
  const rule = readScheduleRule(value)
  if (!rule) return '-'

  const window = `${rule.startTime}–${rule.endTime}`
  if (rule.frequency === 'monthly') {
    const days = (rule.daysOfMonth ?? []).join(', ')
    return t('schedule.summaryMonthly', 'Monthly on day(s) {days}, {window}', {
      days: days || '—',
      window,
    })
  }

  const days = (rule.daysOfWeek ?? [])
    .map((day) => {
      const key = WEEKDAY_KEYS[day]
      return key ? t(key[0], key[1]) : String(day)
    })
    .join(', ')
  const parity =
    rule.weekParity === 'even'
      ? t('schedule.parityEven', 'Even weeks')
      : rule.weekParity === 'odd'
        ? t('schedule.parityOdd', 'Odd weeks')
        : t('schedule.parityAll', 'Every week')

  return t('schedule.summaryWeekly', '{parity} on {days}, {window}', {
    parity,
    days: days || '—',
    window,
  })
}
