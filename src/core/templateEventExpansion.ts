import type { DayPilot } from '@daypilot/daypilot-lite-vue'
import {
  combineDateTime,
  normalizeScheduleRules,
  ruleMatchesDay,
  startOfDay,
} from '@/core/scheduleGeneration'
import type { SchedulerSettings } from '@/interfaces'

function scalarId(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'object') {
    const id = (value as Record<string, unknown>).id
    if (typeof id === 'string' || typeof id === 'number') return id
  }
  return null
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function dateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return startOfDay(date)
}

/**
 * Expands template records into virtual DayPilot events by applying each
 * record's recurrence rule within the intersection of:
 *   - the scheduler visible range [rangeStart, rangeStart+rangeDays)
 *   - the record's own [startField, endField] window
 *
 * Events are never written to the database.
 */
export function expandTemplateEvents(
  records: Record<string, unknown>[],
  settings: SchedulerSettings,
  rangeStart: Date,
  rangeDays: number,
  resourceKey: string,
  getResourceColumnId: (resourceValue: string, dayKey: string) => string,
  getTitle: (record: Record<string, unknown>) => string,
  getBackColor: (record: Record<string, unknown>) => string | undefined,
): DayPilot.EventData[] {
  const ruleField = settings.event.ruleField ?? 'template'
  const startField = settings.event.startField
  const endField = settings.event.endField
  const resourceField = settings.event.resourceField
  const primaryKey = settings.event.primaryKey

  const visibleEnd = addDays(rangeStart, rangeDays - 1)
  const events: DayPilot.EventData[] = []

  for (const record of records) {
    const templateId = scalarId(record[primaryKey])
    if (templateId === null) continue

    const rules = normalizeScheduleRules(record[ruleField])
    if (rules.length === 0) continue

    const templateStart = parseDay(record[startField])
    if (!templateStart) continue
    const templateEnd = parseDay(record[endField])

    const rawResource = record[resourceField]
    const resourceId = scalarId(rawResource)
    if (resourceId === null) continue
    const resourceValue = `${resourceKey}:${String(resourceId)}`

    const title = getTitle(record)
    const backColor = getBackColor(record)
    const collection = settings.event.collection

    // Intersection of visible range and template [start, end]
    const from = templateStart > rangeStart ? templateStart : rangeStart
    let to = visibleEnd
    if (templateEnd && templateEnd < to) to = templateEnd
    if (from > to) continue

    // startField also acts as the week-parity recurrence anchor
    const anchor = templateStart

    for (let day = new Date(from); day <= to; day = addDays(day, 1)) {
      for (let ruleIdx = 0; ruleIdx < rules.length; ruleIdx++) {
        const rule = rules[ruleIdx]
        if (!ruleMatchesDay(rule, day, anchor)) continue

        const dayKey = dateString(day)
        const eventStart = combineDateTime(day, rule.startTime)
        const eventEnd = combineDateTime(day, rule.endTime)
        const columnId = getResourceColumnId(resourceValue, dayKey)
        const eventId = `tpl_${templateId}_r${ruleIdx}_${dayKey}_p${resourceId}`

        const event: DayPilot.EventData = {
          id: eventId,
          text: title,
          start: eventStart,
          end: eventEnd,
          resource: columnId,
          tags: {
            collection,
            id: templateId,
            recordId: templateId,
            virtual: true,
          },
        }
        if (backColor) {
          event.backColor = backColor
        }
        events.push(event)
      }
    }
  }

  return events
}
