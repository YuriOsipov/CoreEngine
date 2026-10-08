import { nextCronDate, validateCron } from './cron.js'

export type ScheduleInterval = 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'cron'

export interface ScheduleRule {
  interval: ScheduleInterval
  every: number
  minute: number
  hour: number
  weekdays: number[]
  dayOfMonth: number
  cron: string
}

export interface ScheduleSpec {
  rules: ScheduleRule[]
}

const INTERVALS: ScheduleInterval[] = [
  'minutes',
  'hours',
  'days',
  'weeks',
  'months',
  'cron',
]

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function asRule(value: unknown): ScheduleRule {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
  const interval = INTERVALS.includes(row.interval as ScheduleInterval)
    ? (row.interval as ScheduleInterval)
    : 'days'
  const weekdays = Array.isArray(row.weekdays)
    ? row.weekdays
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 7)
        .map((entry) => (entry === 7 ? 0 : entry))
    : [1]
  return {
    interval,
    every: clamp(row.every, 1, 59, 1),
    minute: clamp(row.minute, 0, 59, 0),
    hour: clamp(row.hour, 0, 23, 0),
    weekdays: weekdays.length ? Array.from(new Set(weekdays)) : [1],
    dayOfMonth: clamp(row.dayOfMonth, 1, 31, 1),
    cron: typeof row.cron === 'string' ? row.cron : '',
  }
}

export function defaultScheduleRule(): ScheduleRule {
  return {
    interval: 'days',
    every: 1,
    minute: 0,
    hour: 2,
    weekdays: [1],
    dayOfMonth: 1,
    cron: '',
  }
}

export function parseScheduleSpec(raw: unknown, fallbackCron?: string): ScheduleSpec {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
  const list = Array.isArray(source.rules) ? source.rules : []
  const rules = list.map(asRule).filter(Boolean)
  if (rules.length) return { rules }
  if (fallbackCron && fallbackCron.trim()) {
    return { rules: [cronToRule(fallbackCron)] }
  }
  return { rules: [defaultScheduleRule()] }
}

export function compileRuleToCron(rule: ScheduleRule): string {
  const normalized = asRule(rule)
  if (normalized.interval === 'cron') {
    const expression = normalized.cron.trim()
    validateCron(expression)
    return expression
  }
  if (normalized.interval === 'minutes') {
    const every = clamp(normalized.every, 1, 59, 5)
    return every === 1 ? '* * * * *' : `*/${every} * * * *`
  }
  if (normalized.interval === 'hours') {
    const every = clamp(normalized.every, 1, 23, 1)
    const minute = clamp(normalized.minute, 0, 59, 0)
    return every === 1 ? `${minute} * * * *` : `${minute} */${every} * * *`
  }
  if (normalized.interval === 'days') {
    const every = clamp(normalized.every, 1, 31, 1)
    const hour = clamp(normalized.hour, 0, 23, 0)
    const minute = clamp(normalized.minute, 0, 59, 0)
    return every === 1
      ? `${minute} ${hour} * * *`
      : `${minute} ${hour} */${every} * *`
  }
  if (normalized.interval === 'weeks') {
    const hour = clamp(normalized.hour, 0, 23, 0)
    const minute = clamp(normalized.minute, 0, 59, 0)
    const days = normalized.weekdays.length ? normalized.weekdays.join(',') : '1'
    return `${minute} ${hour} * * ${days}`
  }
  const every = clamp(normalized.every, 1, 12, 1)
  const day = clamp(normalized.dayOfMonth, 1, 31, 1)
  const hour = clamp(normalized.hour, 0, 23, 0)
  const minute = clamp(normalized.minute, 0, 59, 0)
  return every === 1
    ? `${minute} ${hour} ${day} * *`
    : `${minute} ${hour} ${day} */${every} *`
}

export function compileSchedule(spec: ScheduleSpec): string[] {
  const rules = spec.rules.length ? spec.rules : [defaultScheduleRule()]
  const crons = rules.map((rule) => compileRuleToCron(rule))
  return Array.from(new Set(crons))
}

export function nextScheduleDate(
  spec: ScheduleSpec,
  from: Date,
  timeZone: string,
): Date | null {
  let soonest: Date | null = null
  for (const expression of compileSchedule(spec)) {
    const next = nextCronDate(expression, from, timeZone)
    if (!next) continue
    if (!soonest || next.getTime() < soonest.getTime()) soonest = next
  }
  return soonest
}

export function cronToRule(expression: string): ScheduleRule {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return { ...defaultScheduleRule(), interval: 'cron', cron: expression.trim() }
  }
  const [minute, hour, dayOfMonth, month, weekday] = parts
  const step = (field: string): number | null => {
    const match = /^\*\/(\d+)$/.exec(field)
    return match ? Number(match[1]) : null
  }
  const isStar = (field: string) => field === '*'
  const isNumber = (field: string) => /^\d+$/.test(field)

  if (isStar(hour) && isStar(dayOfMonth) && isStar(month) && isStar(weekday)) {
    if (minute === '*') return { ...defaultScheduleRule(), interval: 'minutes', every: 1 }
    const every = step(minute)
    if (every) return { ...defaultScheduleRule(), interval: 'minutes', every }
  }
  if (isNumber(minute) && isStar(dayOfMonth) && isStar(month) && isStar(weekday)) {
    if (hour === '*') {
      return {
        ...defaultScheduleRule(),
        interval: 'hours',
        every: 1,
        minute: Number(minute),
      }
    }
    const every = step(hour)
    if (every) {
      return {
        ...defaultScheduleRule(),
        interval: 'hours',
        every,
        minute: Number(minute),
      }
    }
  }
  if (isNumber(minute) && isNumber(hour) && isStar(month) && isStar(weekday)) {
    if (isStar(dayOfMonth)) {
      return {
        ...defaultScheduleRule(),
        interval: 'days',
        every: 1,
        hour: Number(hour),
        minute: Number(minute),
      }
    }
    const every = step(dayOfMonth)
    if (every) {
      return {
        ...defaultScheduleRule(),
        interval: 'days',
        every,
        hour: Number(hour),
        minute: Number(minute),
      }
    }
  }
  if (
    isNumber(minute) &&
    isNumber(hour) &&
    isStar(dayOfMonth) &&
    isStar(month) &&
    !isStar(weekday)
  ) {
    const weekdays = weekday
      .split(',')
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry))
      .map((entry) => (entry === 7 ? 0 : entry))
    if (weekdays.length) {
      return {
        ...defaultScheduleRule(),
        interval: 'weeks',
        hour: Number(hour),
        minute: Number(minute),
        weekdays,
      }
    }
  }
  if (isNumber(minute) && isNumber(hour) && isNumber(dayOfMonth) && isStar(weekday)) {
    const every = month === '*' ? 1 : step(month)
    if (every) {
      return {
        ...defaultScheduleRule(),
        interval: 'months',
        every,
        dayOfMonth: Number(dayOfMonth),
        hour: Number(hour),
        minute: Number(minute),
      }
    }
  }
  return { ...defaultScheduleRule(), interval: 'cron', cron: expression.trim() }
}
