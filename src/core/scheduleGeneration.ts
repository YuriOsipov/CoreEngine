import {
  bridgeReadItems,
} from '@/core/graphql/itemsBridge'
import type {
  ScheduleRule,
  ScheduleRuleFrequency,
  ScheduleWeekParity,
  SchedulerAvailabilitySettings,
} from '@/interfaces'
import { generateScheduleSlotsViaGraphQL } from '@/core/graphql/tasksApi'

export {
  SCHEDULE_SLOT_COLLECTION,
  SCHEDULE_TEMPLATE_COLLECTION,
  SCHEDULE_TEMPLATE_RULE_FIELD,
} from '@/core/scheduleConstants'

export { ruleMatchesDay, combineDateTime, startOfDay, isoWeekday, weekParityIndex }

const DEFAULT_INTAKE_TYPE = 'intake'
const DEFAULT_BLOCK_TYPE = 'block'

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

export interface GenerateScheduleOptions {
  /** Inclusive start of the target period (date-only is respected). */
  rangeStart: Date | string
  /** Inclusive end of the target period. */
  rangeEnd: Date | string
  /** Optional provider filter; when set, only these providers get slots. */
  providerIds?: Array<string | number>
  /** Optional facility filter applied to templates. */
  facilityIds?: Array<string | number>
}

export interface GenerateScheduleResult {
  templatesProcessed: number
  created: number
  skipped: number
}

function toDateOnly(value: Date | string): string {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/)
    if (match) return match[1]
  }
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/** Local midnight for the given date (drops time + tz drift). */
function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

/** ISO weekday: 1=Mon … 7=Sun. */
function isoWeekday(value: Date): number {
  const day = value.getDay()
  return day === 0 ? 7 : day
}

/** Local Monday (00:00) of the week containing the date. */
function mondayOf(value: Date): Date {
  const base = startOfDay(value)
  const offset = isoWeekday(base) - 1
  base.setDate(base.getDate() - offset)
  return base
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

/** Week parity relative to the anchor date. 0 = even, 1 = odd. */
function weekParityIndex(day: Date, anchor: Date): number {
  const weeks = Math.round((mondayOf(day).getTime() - mondayOf(anchor).getTime()) / MS_PER_WEEK)
  return ((weeks % 2) + 2) % 2
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Combines a date-only value with an 'HH:mm' time into a local datetime string. */
function combineDateTime(day: Date, time: string): string {
  const [hours = '0', minutes = '0'] = time.split(':')
  const date = `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`
  return `${date}T${pad2(Number(hours))}:${pad2(Number(minutes))}:00`
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

/** Parses the template `template` field (array / object / JSON string) into rules. */
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

function ruleMatchesDay(rule: ScheduleRule, day: Date, anchor: Date): boolean {
  if (rule.frequency === 'monthly') {
    return (rule.daysOfMonth ?? []).includes(day.getDate())
  }
  if (!(rule.daysOfWeek ?? []).includes(isoWeekday(day))) return false
  if (rule.weekParity === 'all' || !rule.weekParity) return true
  const parity = weekParityIndex(day, anchor)
  return rule.weekParity === 'even' ? parity === 0 : parity === 1
}

/**
 * Expands published templates into dated `crm_schedule` rows via the BFF.
 * Idempotent: existing provider+type+start+end rows are skipped.
 */
export async function generateScheduleSlots(
  options: GenerateScheduleOptions,
): Promise<GenerateScheduleResult> {
  return generateScheduleSlotsViaGraphQL({
    rangeStart: toDateOnly(options.rangeStart),
    rangeEnd: toDateOnly(options.rangeEnd),
    providerIds: options.providerIds?.map(String),
    facilityIds: options.facilityIds?.map(String),
  })
}

// Availability guard (visit scheduler)

interface AvailabilityWindow {
  start: number
  end: number
}

interface ProviderAvailability {
  intake: AvailabilityWindow[]
  block: AvailabilityWindow[]
}

/** Loads a provider's intake / block windows overlapping the given instant's day. */
export async function loadProviderAvailability(
  settings: SchedulerAvailabilitySettings,
  providerId: string | number,
  reference: Date,
): Promise<ProviderAvailability> {
  const dayStart = startOfDay(reference)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)

  const rows = await bridgeReadItems(settings.collection, {
    limit: -1,
    filter: {
      [settings.resourceField]: { _eq: providerId },
      [settings.startField]: { _lt: combineDateTime(dayEnd, '00:00') },
      [settings.endField]: { _gt: combineDateTime(dayStart, '00:00') },
    },
    fields: [settings.startField, settings.endField, settings.typeField],
  })

  const availability: ProviderAvailability = { intake: [], block: [] }
  const intakeValue = settings.intakeValue || DEFAULT_INTAKE_TYPE
  const blockValue = settings.blockValue || DEFAULT_BLOCK_TYPE

  for (const row of rows) {
    const start = toDate(row[settings.startField] as string).getTime()
    const end = toDate(row[settings.endField] as string).getTime()
    if (Number.isNaN(start) || Number.isNaN(end)) continue
    const window: AvailabilityWindow = { start, end }
    const type = String(row[settings.typeField] ?? '')
    if (type === blockValue) availability.block.push(window)
    else if (type === intakeValue) availability.intake.push(window)
  }

  return availability
}

function isContainedInAny(
  target: AvailabilityWindow,
  windows: AvailabilityWindow[],
): boolean {
  return windows.some((window) => target.start >= window.start && target.end <= window.end)
}

function overlapsAny(
  target: AvailabilityWindow,
  windows: AvailabilityWindow[],
): boolean {
  return windows.some((window) => target.start < window.end && target.end > window.start)
}

/**
 * Returns true when a visit spanning [start, end] for the provider is allowed:
 * fully inside an intake window and not overlapping any block window.
 */
export async function isVisitAllowed(
  settings: SchedulerAvailabilitySettings,
  providerId: string | number,
  start: Date,
  end: Date,
): Promise<boolean> {
  const availability = await loadProviderAvailability(settings, providerId, start)
  const target: AvailabilityWindow = { start: start.getTime(), end: end.getTime() }
  if (availability.intake.length === 0) return false
  if (!isContainedInAny(target, availability.intake)) return false
  if (overlapsAny(target, availability.block)) return false
  return true
}
