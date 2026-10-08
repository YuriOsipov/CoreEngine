export type ScheduleRuleFrequency = 'weekly' | 'monthly'
export type ScheduleWeekParity = 'all' | 'even' | 'odd'

export interface ScheduleRule {
  frequency: ScheduleRuleFrequency
  weekParity?: ScheduleWeekParity
  daysOfWeek?: number[]
  daysOfMonth?: number[]
  startTime: string
  endTime: string
}

const WEEKDAY_ALIASES: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

export function isoWeekday(value: Date): number {
  const day = value.getDay()
  return day === 0 ? 7 : day
}

function mondayOf(value: Date): Date {
  const base = startOfDay(value)
  const offset = isoWeekday(base) - 1
  base.setDate(base.getDate() - offset)
  return base
}

export function weekParityIndex(day: Date, anchor: Date): number {
  const weeks = Math.round(
    (mondayOf(day).getTime() - mondayOf(anchor).getTime()) / MS_PER_WEEK,
  )
  return ((weeks % 2) + 2) % 2
}

export function combineDateTime(day: Date, time: string): string {
  const [hours = '0', minutes = '0'] = time.split(':')
  const date = `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`
  return `${date}T${pad2(Number(hours))}:${pad2(Number(minutes))}:00`
}

export function toSlotDateKey(value: unknown): string {
  if (typeof value !== 'string' && !(value instanceof Date)) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : ''
  return combineDateTime(date, `${pad2(date.getHours())}:${pad2(date.getMinutes())}`)
}

function normalizeDayList(value: unknown, aliasMap?: Record<string, number>): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\s]+/)
      : value === null || value === undefined
        ? []
        : [value]

  const days = raw
    .map((entry) => {
      if (typeof entry === 'number') return entry
      const token = String(entry).trim().toLowerCase()
      if (!token) return null
      if (aliasMap && token in aliasMap) return aliasMap[token]
      const parsed = Number(token)
      return Number.isFinite(parsed) ? parsed : null
    })
    .filter((entry): entry is number => entry !== null)

  return Array.from(new Set(days))
}

export function normalizeScheduleRules(raw: unknown): ScheduleRule[] {
  let source = raw
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source)
    } catch {
      return []
    }
  }
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    source = [source]
  }
  if (!Array.isArray(source)) return []

  return source
    .map((entry) => normalizeScheduleRule(entry))
    .filter((rule): rule is ScheduleRule => rule !== null)
}

function normalizeScheduleRule(entry: unknown): ScheduleRule | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>

  const startTime = typeof record.startTime === 'string' ? record.startTime.trim() : ''
  const endTime = typeof record.endTime === 'string' ? record.endTime.trim() : ''
  if (!startTime || !endTime) return null

  const frequency: ScheduleRuleFrequency =
    record.frequency === 'monthly' ? 'monthly' : 'weekly'

  if (frequency === 'monthly') {
    const daysOfMonth = normalizeDayList(record.daysOfMonth)
    if (daysOfMonth.length === 0) return null
    return { frequency, daysOfMonth, startTime, endTime }
  }

  const daysOfWeek = normalizeDayList(record.daysOfWeek, WEEKDAY_ALIASES)
  if (daysOfWeek.length === 0) return null
  const weekParity: ScheduleWeekParity =
    record.weekParity === 'even' || record.weekParity === 'odd'
      ? record.weekParity
      : 'all'
  return { frequency, weekParity, daysOfWeek, startTime, endTime }
}

export function ruleMatchesDay(rule: ScheduleRule, day: Date, anchor: Date): boolean {
  if (rule.frequency === 'monthly') {
    return (rule.daysOfMonth ?? []).includes(day.getDate())
  }
  if (!(rule.daysOfWeek ?? []).includes(isoWeekday(day))) return false
  if (rule.weekParity === 'all' || !rule.weekParity) return true
  const parity = weekParityIndex(day, anchor)
  return rule.weekParity === 'even' ? parity === 0 : parity === 1
}
