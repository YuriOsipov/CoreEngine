/**
 * Five-field cron (minute hour day-of-month month weekday).
 * Supports *, lists, ranges, and steps. Weekday 0/7 = Sunday.
 */

const WEEKDAY_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const FIELD_BOUNDS: Array<{ min: number; max: number }> = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
]

export interface CronFields {
  minute: Set<number>
  hour: Set<number>
  dayOfMonth: Set<number>
  month: Set<number>
  weekday: Set<number>
  anyDom: boolean
  anyDow: boolean
}

function tokenToNumber(token: string, names?: Record<string, number>): number {
  const lower = token.trim().toLowerCase()
  if (names && lower in names) return names[lower]
  const parsed = Number(lower)
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid cron value "${token}"`)
  }
  return parsed
}

function expandField(
  field: string,
  min: number,
  max: number,
  names?: Record<string, number>,
): Set<number> {
  const values = new Set<number>()
  const pieces = field.split(',')
  for (const piece of pieces) {
    const trimmed = piece.trim()
    if (!trimmed) continue
    const [rangePart, stepRaw] = trimmed.split('/')
    const step = stepRaw ? Number(stepRaw) : 1
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid cron step in "${field}"`)
    }
    let start = min
    let end = max
    if (rangePart !== '*') {
      const [left, right] = rangePart.split('-')
      start = tokenToNumber(left, names)
      end = right != null ? tokenToNumber(right, names) : start
    }
    if (names === WEEKDAY_NAMES) {
      if (start === 7) start = 0
      if (end === 7) end = 0
      if (rangePart !== '*' && start > end && start === 0) {
        // sun wrapped; treat 7 as 0 already
      }
    }
    if (start > end) {
      for (let value = start; value <= max; value += step) values.add(value)
      for (let value = min; value <= end; value += step) values.add(value)
    } else {
      for (let value = start; value <= end; value += step) values.add(value)
    }
  }
  for (const value of [...values]) {
    if (value < min || value > max) {
      throw new Error(`Cron value ${value} out of range ${min}-${max}`)
    }
  }
  if (values.size === 0) throw new Error(`Empty cron field "${field}"`)
  if (names === WEEKDAY_NAMES && values.has(7)) {
    values.delete(7)
    values.add(0)
  }
  return values
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error('Cron must have 5 fields: minute hour day-of-month month weekday')
  }
  const [minute, hour, dayOfMonth, month, weekday] = parts
  return {
    minute: expandField(minute, FIELD_BOUNDS[0].min, FIELD_BOUNDS[0].max),
    hour: expandField(hour, FIELD_BOUNDS[1].min, FIELD_BOUNDS[1].max),
    dayOfMonth: expandField(dayOfMonth, FIELD_BOUNDS[2].min, FIELD_BOUNDS[2].max),
    month: expandField(month, FIELD_BOUNDS[3].min, FIELD_BOUNDS[3].max, MONTH_NAMES),
    weekday: expandField(weekday, FIELD_BOUNDS[4].min, FIELD_BOUNDS[4].max, WEEKDAY_NAMES),
    anyDom: dayOfMonth === '*',
    anyDow: weekday === '*',
  }
}

export function validateCron(expression: string): void {
  parseCron(expression)
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const mapped: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') mapped[part.type] = part.value
  }
  const weekdayName = (mapped.weekday || '').slice(0, 3).toLowerCase()
  return {
    year: Number(mapped.year),
    month: Number(mapped.month),
    day: Number(mapped.day),
    hour: Number(mapped.hour),
    minute: Number(mapped.minute),
    weekday: WEEKDAY_NAMES[weekdayName] ?? 0,
  }
}

export function cronMatches(expression: string, date: Date, timeZone: string): boolean {
  const cron = parseCron(expression)
  const parts = zonedParts(date, timeZone)
  if (!cron.minute.has(parts.minute)) return false
  if (!cron.hour.has(parts.hour)) return false
  if (!cron.month.has(parts.month)) return false

  const domMatch = cron.dayOfMonth.has(parts.day)
  const dowMatch = cron.weekday.has(parts.weekday)
  if (!cron.anyDom && !cron.anyDow) return domMatch || dowMatch
  if (!cron.anyDom) return domMatch
  if (!cron.anyDow) return dowMatch
  return true
}

export function nextCronDate(
  expression: string,
  from: Date,
  timeZone: string,
  horizonDays = 366,
): Date | null {
  parseCron(expression)
  const start = new Date(from.getTime())
  start.setUTCSeconds(0, 0)
  start.setTime(start.getTime() + 60_000)
  const limit = from.getTime() + horizonDays * 24 * 60 * 60 * 1000
  for (let t = start.getTime(); t <= limit; t += 60_000) {
    const candidate = new Date(t)
    if (cronMatches(expression, candidate, timeZone)) return candidate
  }
  return null
}

export interface CivilYmd {
  year: number
  month: number
  day: number
}

export function zonedYmd(date: Date, timeZone: string): CivilYmd {
  const parts = zonedParts(date, timeZone)
  return { year: parts.year, month: parts.month, day: parts.day }
}

export function monthRangeIso(
  now: Date,
  timeZone: string,
  offsetMonths: number,
): { rangeStart: string; rangeEnd: string } {
  const { year, month } = zonedYmd(now, timeZone)
  const index = year * 12 + (month - 1) + offsetMonths
  const startYear = Math.floor(index / 12)
  const startMonth = (index % 12) + 1
  const endIndex = index + 1
  const endYear = Math.floor(endIndex / 12)
  const endMonth = (endIndex % 12) + 1
  const lastDay = new Date(Date.UTC(endYear, endMonth - 1, 0)).getUTCDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    rangeStart: `${startYear}-${pad(startMonth)}-01`,
    rangeEnd: `${startYear}-${pad(startMonth)}-${pad(lastDay)}`,
  }
}

export function nextDaysRangeIso(
  now: Date,
  timeZone: string,
  days: number,
): { rangeStart: string; rangeEnd: string } {
  const start = zonedYmd(now, timeZone)
  const utcStart = Date.UTC(start.year, start.month - 1, start.day)
  const utcEnd = utcStart + Math.max(0, days - 1) * 24 * 60 * 60 * 1000
  const end = new Date(utcEnd)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    rangeStart: `${start.year}-${pad(start.month)}-${pad(start.day)}`,
    rangeEnd: `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`,
  }
}
