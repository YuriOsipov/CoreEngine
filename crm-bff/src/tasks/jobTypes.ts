import { runLocalFlow } from '../flows/localFlows.js'
import { generateScheduleSlots } from '../schedule/generateSlots.js'
import { maintainRecentRecordViews } from '../services/recentRecordsService.js'
import { runSchemaDriftCheck } from '../sync/schemaSyncService.js'
import { monthRangeIso, nextDaysRangeIso } from './cron.js'
import { resolveConnectionKey } from './connectionKey.js'
import { dispatchDueMessages } from './dispatchDueMessages.js'
import { purgeArchivedRecords } from './purgeArchivedRecords.js'

export const JOB_TYPES = [
  'generate_slots',
  'verify_database',
  'call_connection',
  /** @deprecated Alias of call_connection — kept for existing rows. */
  'send_notification',
  'maintain_recent_views',
  'dispatch_due_messages',
  'purge_archived_records',
] as const

export type JobType = (typeof JOB_TYPES)[number]

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value)
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.floor(n)
}

function resolveSlotRange(
  params: Record<string, unknown>,
  timeZone: string,
  now = new Date(),
): { rangeStart: string; rangeEnd: string } {
  const start =
    typeof params.rangeStart === 'string' && params.rangeStart.trim()
      ? params.rangeStart.trim()
      : ''
  const end =
    typeof params.rangeEnd === 'string' && params.rangeEnd.trim()
      ? params.rangeEnd.trim()
      : ''
  if (start && end) return { rangeStart: start, rangeEnd: end }

  const range = typeof params.range === 'string' ? params.range.trim() : 'next_month'
  if (range === 'current_month') return monthRangeIso(now, timeZone, 0)
  if (range === 'next_n_days') {
    const days = Number(params.days)
    return nextDaysRangeIso(now, timeZone, Number.isFinite(days) && days > 0 ? days : 30)
  }
  return monthRangeIso(now, timeZone, 1)
}

export async function executeJobType(
  jobType: JobType,
  params: Record<string, unknown>,
  timeZone: string,
): Promise<Record<string, unknown>> {
  if (jobType === 'generate_slots') {
    const range = resolveSlotRange(params, timeZone)
    const result = await generateScheduleSlots({
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
      providerIds: stringList(params.providerIds),
      facilityIds: stringList(params.facilityIds),
    })
    return { ...range, ...result }
  }

  if (jobType === 'verify_database') {
    const entity =
      typeof params.entity === 'string' && params.entity.trim()
        ? params.entity.trim()
        : null
    const job = await runSchemaDriftCheck({ entityApiName: entity })
    const result = asObject(job.result)
    const errorCount = Number(result.errorCount ?? 0)
    if (job.status === 'FAILED' || errorCount > 0) {
      throw new Error(job.error || 'Database verification found errors')
    }
    return {
      syncJobId: job.id,
      status: job.status,
      ...result,
    }
  }

  if (jobType === 'call_connection' || jobType === 'send_notification') {
    const connectionKey = resolveConnectionKey(params)
    if (!connectionKey) {
      throw new Error(
        'call_connection requires params.connectionKey (Setup → Connections key)',
      )
    }
    const payload = { ...asObject(params.payload) }
    if (typeof payload.timeZone !== 'string' || !payload.timeZone.trim()) {
      payload.timeZone = timeZone
    }
    const result = await runLocalFlow(connectionKey, payload)
    return { connectionKey, ...result }
  }

  if (jobType === 'maintain_recent_views') {
    const result = await maintainRecentRecordViews({
      retentionDays: positiveInt(params.retentionDays, 90),
      maxPerUserCollection: positiveInt(params.maxPerUserCollection, 200),
    })
    return { ...result }
  }

  if (jobType === 'dispatch_due_messages') {
    return dispatchDueMessages(params)
  }

  if (jobType === 'purge_archived_records') {
    const result = await purgeArchivedRecords(params)
    return { ...result }
  }

  throw new Error(`Unsupported job type "${jobType}"`)
}
