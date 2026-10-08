import { createRecord, findManyRecords } from '../adapters/recordsAdapter.js'
import { query } from '../db/pool.js'
import { fkIdFromValue, loadM2ORelations } from '../adapters/records/relations.js'
import {
  DEFAULT_INTAKE_TYPE,
  SCHEDULE_SLOT_COLLECTION,
  SCHEDULE_SLOT_TEMPLATE_FIELD,
  SCHEDULE_TEMPLATE_COLLECTION,
  PUBLISHED_STATUS,
} from './constants.js'
import {
  combineDateTime,
  normalizeScheduleRules,
  ruleMatchesDay,
  startOfDay,
  toSlotDateKey,
} from './rules.js'

export interface GenerateScheduleOptions {
  rangeStart: Date | string
  rangeEnd: Date | string
  providerIds?: Array<string | number>
  facilityIds?: Array<string | number>
}

export interface GenerateScheduleResult {
  templatesProcessed: number
  created: number
  skipped: number
}

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
    )
  }
  return new Date(value)
}

function slotKey(
  providerId: string | number | null,
  type: unknown,
  start: unknown,
  end: unknown,
): string {
  return [
    String(providerId ?? ''),
    String(type ?? ''),
    toSlotDateKey(start),
    toSlotDateKey(end),
  ].join('|')
}

function collectIds(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value.flatMap(collectIds)
  }
  const direct = fkIdFromValue(value)
  if (direct && (typeof value !== 'object' || value === null)) return [direct]
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const nestedKeys = [
      'provider',
      'directus_users_id',
      'user',
      'users_id',
      'crm_users_id',
    ]
    for (const key of nestedKeys) {
      const nested = fkIdFromValue(record[key])
      if (nested) return [nested]
    }
    const id = fkIdFromValue(record)
    return id ? [id] : []
  }
  return direct ? [direct] : []
}

async function entityFieldSet(apiName: string, names: string[]): Promise<Set<string>> {
  const rows = await query<{ api_name: string }>(
    `SELECT f.api_name
     FROM public.fields f
     JOIN public.entities e ON e.id = f.entity_id
     WHERE e.api_name = $1
       AND e.deleted_at IS NULL
       AND f.api_name = ANY($2::text[])`,
    [apiName, names],
  )
  return new Set(rows.map((row) => row.api_name))
}

async function loadTemplates(options: GenerateScheduleOptions) {
  const filter: Record<string, unknown> = {
    status: { _eq: PUBLISHED_STATUS },
  }
  if (options.facilityIds && options.facilityIds.length > 0) {
    filter.facility = { _in: options.facilityIds.map(String) }
  }

  const fields = [
    'id',
    'type',
    'date_start',
    'date_end',
    'facility',
    'template',
    'provider',
  ]

  const { nodes } = await findManyRecords(SCHEDULE_TEMPLATE_COLLECTION, {
    limit: -1,
    filter,
    fields,
  })

  const providerFilter =
    options.providerIds && options.providerIds.length > 0
      ? new Set(options.providerIds.map((id) => String(id)))
      : null

  return nodes.map((row) => {
    let providerIds = collectIds(row.provider)
    if (providerFilter) {
      providerIds = providerIds.filter((id) => providerFilter.has(String(id)))
    }
    return {
      id: row.id as string | number,
      type: row.type,
      date_start: row.date_start,
      date_end: row.date_end,
      facility: row.facility,
      template: row.template,
      providerIds,
    }
  })
}

async function loadExistingSlotKeys(options: GenerateScheduleOptions): Promise<Set<string>> {
  const rangeStart = startOfDay(toDate(options.rangeStart))
  const rangeEnd = startOfDay(toDate(options.rangeEnd))
  rangeEnd.setDate(rangeEnd.getDate() + 1)

  const filter: Record<string, unknown> = {
    date_start: {
      _gte: combineDateTime(rangeStart, '00:00'),
      _lt: combineDateTime(rangeEnd, '00:00'),
    },
  }
  if (options.providerIds && options.providerIds.length > 0) {
    filter.provider = { _in: options.providerIds.map(String) }
  }

  const { nodes } = await findManyRecords(SCHEDULE_SLOT_COLLECTION, {
    limit: -1,
    filter,
    fields: ['provider', 'type', 'date_start', 'date_end'],
  })

  const keys = new Set<string>()
  for (const row of nodes) {
    keys.add(slotKey(fkIdFromValue(row.provider), row.type, row.date_start, row.date_end))
  }
  return keys
}

/**
 * Expand published templates into dated `crm_schedule` rows.
 * Idempotent: existing provider+type+start+end rows are skipped.
 */
export async function generateScheduleSlots(
  options: GenerateScheduleOptions,
): Promise<GenerateScheduleResult> {
  const [templates, existingKeys, slotFields, m2o] = await Promise.all([
    loadTemplates(options),
    loadExistingSlotKeys(options),
    entityFieldSet(SCHEDULE_SLOT_COLLECTION, ['name', 'note', SCHEDULE_SLOT_TEMPLATE_FIELD]),
    loadM2ORelations(SCHEDULE_SLOT_COLLECTION),
  ])

  const slotHasName = slotFields.has('name')
  const slotHasNote = slotFields.has('note')
  const slotLinksTemplate =
    slotFields.has(SCHEDULE_SLOT_TEMPLATE_FIELD) &&
    m2o.some(
      (row) =>
        row.fieldApiName === SCHEDULE_SLOT_TEMPLATE_FIELD &&
        row.relatedEntityApiName === SCHEDULE_TEMPLATE_COLLECTION,
    )

  const rangeStart = startOfDay(toDate(options.rangeStart))
  const rangeEnd = startOfDay(toDate(options.rangeEnd))

  const seen = new Set(existingKeys)
  const payloads: Record<string, unknown>[] = []
  let skipped = 0

  for (const template of templates) {
    const rules = normalizeScheduleRules(template.template)
    if (rules.length === 0 || template.providerIds.length === 0) continue

    const tplStartRaw = toDate(String(template.date_start ?? ''))
    if (Number.isNaN(tplStartRaw.getTime())) continue
    const anchor = startOfDay(tplStartRaw)
    const from = new Date(Math.max(anchor.getTime(), rangeStart.getTime()))
    const to = new Date(rangeEnd)

    const type = typeof template.type === 'string' ? template.type : DEFAULT_INTAKE_TYPE
    const facilityId = fkIdFromValue(template.facility)

    for (let day = new Date(from); day <= to; day.setDate(day.getDate() + 1)) {
      for (const rule of rules) {
        if (!ruleMatchesDay(rule, day, anchor)) continue

        const dateStart = combineDateTime(day, rule.startTime)
        const dateEnd = combineDateTime(day, rule.endTime)

        for (const providerId of template.providerIds) {
          const key = slotKey(providerId, type, dateStart, dateEnd)
          if (seen.has(key)) {
            skipped += 1
            continue
          }
          seen.add(key)

          const payload: Record<string, unknown> = {
            provider: providerId,
            type,
            date_start: dateStart,
            date_end: dateEnd,
          }
          if (facilityId !== null) payload.facility = facilityId
          if (slotLinksTemplate) payload[SCHEDULE_SLOT_TEMPLATE_FIELD] = template.id
          if (slotHasName) payload.name = `${type}`
          if (slotHasNote) payload.note = null
          payloads.push(payload)
        }
      }
    }
  }

  for (const payload of payloads) {
    await createRecord(SCHEDULE_SLOT_COLLECTION, payload)
  }

  return {
    templatesProcessed: templates.length,
    created: payloads.length,
    skipped,
  }
}
