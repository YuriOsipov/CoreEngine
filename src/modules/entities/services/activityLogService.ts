import {
  mapUiActionsToPlatform,
  readRecordActivitiesBridge,
  readRecordRevisionsBridge,
} from '@/core/graphql/auditApi'
import { readUsersBridge } from '@/core/graphql/usersApi'
import { isUsersAssetCollection } from '@/core/usersField'
import {
  effectiveDateDisplayFormat,
  formatDateValue,
  formatLocalizedDateTime,
} from '@/core/dateFormatting'
import type { ActivityLogAction, ActivityLogSettings, FieldDefinition } from '@/interfaces'
import { normalizeActivityLogSettings } from '@/interfaces'
import { translateField } from '@/core/translation'
import {
  formatSensitivitySummary,
  isSensitivityMatrixFieldDefinition,
  normalizeSensitivityValue,
} from '@/core/sensitivityField'
import { formatUserLabel, formatDisplayValue } from '../utils/recordDisplay'
import { getCachedCollectionFields, getCachedRelations } from './collectionSchema'

export interface ActivityLogDeltaEntry {
  field: string
  label: string
  /** Short text for the Changes column. */
  previousPreview: string | null
  valuePreview: string
  /** Full value shown only when the row is expanded. */
  previousValue: string | null
  value: string
}

export interface ActivityLogEntry {
  id: number
  action: string
  timestamp: string
  timestampLabel: string
  userName: string
  comment: string | null
  summary: string
  deltas: ActivityLogDeltaEntry[]
}

export interface FetchRecordActivityLogOptions {
  collection: string
  recordId: string | number
  settings?: ActivityLogSettings | null
}

interface FieldDisplayContext {
  labels: Record<string, string>
  definitions: Map<string, FieldDefinition>
  userRelationFields: Set<string>
  userLabelCache: Map<string, string>
}

interface RevisionSnapshot {
  data: Record<string, unknown>
  parentId: number | null
}

const HIDDEN_DELTA_FIELDS = new Set([
  'id',
  'user_created',
  'user_updated',
  'date_created',
  'date_updated',
  'created_at',
  'updated_at',
])

const ACTIVITY_LOG_FIELDS = [
  'id',
  'action',
  'timestamp',
  'user.first_name',
  'user.last_name',
  'revisions.id',
] as const

function formatActivityUser(
  user: Record<string, unknown> | null | undefined,
): string {
  if (!user || typeof user !== 'object') return ''

  const fullName = [user.first_name, user.last_name]
    .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
    .join(' ')
    .trim()
  if (fullName) return fullName

  for (const field of ['email', 'name', 'title'] as const) {
    const value = user[field]
    if (value !== null && value !== undefined && value !== '') {
      return String(value)
    }
  }

  return ''
}

function isDateLikeField(definition: FieldDefinition | undefined): boolean {
  if (!definition) return false
  const type = definition.type?.toLowerCase()
  return type === 'date' || type === 'timestamp' || type === 'datetime' || type === 'time'
}

function isUuidString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
}

const PREVIEW_MAX_CHARS = 48

function truncateDisplay(text: string, max = PREVIEW_MAX_CHARS): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

function isComplexValue(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

function formatComplexDetail(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatFieldValue(
  field: string,
  value: unknown,
  context: FieldDisplayContext,
  mode: 'preview' | 'detail' = 'detail',
): string {
  const definition = context.definitions.get(field)
  if (definition && isDateLikeField(definition)) {
    const format =
      effectiveDateDisplayFormat(undefined, definition) ??
      (definition.type?.toLowerCase() === 'date'
        ? effectiveDateDisplayFormat('short', definition)
        : undefined)
    const formatted = format
      ? formatDateValue(value, format)
      : formatLocalizedDateTime(value)
    if (formatted) return mode === 'preview' ? truncateDisplay(formatted) : formatted
  }

  if (
    context.userRelationFields.has(field) &&
    isUuidString(value)
  ) {
    const cached = context.userLabelCache.get(value)
    if (cached) return mode === 'preview' ? truncateDisplay(cached) : cached
  }

  if (definition && isSensitivityMatrixFieldDefinition(definition)) {
    if (mode === 'preview') {
      const payload = normalizeSensitivityValue(value)
      const resultCount = payload.results.length
      const noteCount = payload.notes.length
      if (resultCount === 0 && noteCount === 0) return '—'
      if (resultCount === 0) {
        return noteCount === 1 ? '1 note' : `${noteCount} notes`
      }
      const resultLabel =
        resultCount === 1 ? '1 result' : `${resultCount} results`
      return noteCount > 0
        ? `${resultLabel}, ${noteCount === 1 ? '1 note' : `${noteCount} notes`}`
        : resultLabel
    }
    return formatSensitivitySummary(value, '—')
  }

  if (mode === 'preview') {
    if (Array.isArray(value)) {
      if (value.length === 0) return '—'
      if (value.some((item) => item && typeof item === 'object')) {
        return formatDisplayValue(value, {
          emptyValue: '—',
          arrayDisplay: 'count-objects',
        })
      }
      return truncateDisplay(
        formatDisplayValue(value, { emptyValue: '—', arrayDisplay: 'list' }),
      )
    }
    if (isComplexValue(value)) {
      const keys = Object.keys(value as Record<string, unknown>)
      return keys.length === 0 ? '—' : `${keys.length} field${keys.length === 1 ? '' : 's'}`
    }
    return truncateDisplay(
      formatDisplayValue(value, { emptyValue: '—', arrayDisplay: 'list' }),
    )
  }

  if (isComplexValue(value)) {
    return formatComplexDetail(value)
  }

  return formatDisplayValue(value, { emptyValue: '—', arrayDisplay: 'list' })
}

function hasDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>).length > 0
  }
  return true
}

function isHiddenDeltaField(field: string): boolean {
  return field.startsWith('_') || HIDDEN_DELTA_FIELDS.has(field)
}

function revisionRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function revisionId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const record = revisionRecord(value)
  if (!record) return null
  return revisionId(record.id)
}

function normalizeComparableValue(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const parsed = Date.parse(trimmed)
      if (!Number.isNaN(parsed)) {
        return new Date(parsed).toISOString()
      }
    }
    return trimmed
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeComparableValue(item))
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalized: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(record).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      normalized[key] = normalizeComparableValue(nestedValue)
    }
    return normalized
  }

  return String(value)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeComparableValue(left)
  const normalizedRight = normalizeComparableValue(right)

  if (normalizedLeft === normalizedRight) return true

  if (
    typeof normalizedLeft === 'object' &&
    normalizedLeft !== null &&
    typeof normalizedRight === 'object' &&
    normalizedRight !== null
  ) {
    try {
      return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
    } catch {
      return false
    }
  }

  return false
}

function buildDeltaEntry(
  field: string,
  previousValue: unknown,
  nextValue: unknown,
  context: FieldDisplayContext,
): ActivityLogDeltaEntry {
  const hasPrevious = previousValue !== null && previousValue !== undefined
  return {
    field,
    label: context.labels[field] ?? field,
    previousPreview: hasPrevious
      ? formatFieldValue(field, previousValue, context, 'preview')
      : null,
    valuePreview: formatFieldValue(field, nextValue, context, 'preview'),
    previousValue: hasPrevious
      ? formatFieldValue(field, previousValue, context, 'detail')
      : null,
    value: formatFieldValue(field, nextValue, context, 'detail'),
  }
}

function hasComparableSnapshot(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data).filter((field) => !isHiddenDeltaField(field))
  return keys.length > 0
}

function computeDataDiff(
  previousData: Record<string, unknown>,
  currentData: Record<string, unknown>,
  context: FieldDisplayContext,
): ActivityLogDeltaEntry[] {
  const fields = new Set([
    ...Object.keys(previousData),
    ...Object.keys(currentData),
  ])

  const changes: ActivityLogDeltaEntry[] = []

  for (const field of fields) {
    if (isHiddenDeltaField(field)) continue

    const previousValue = previousData[field]
    const nextValue = currentData[field]
    if (valuesEqual(previousValue, nextValue)) continue

    changes.push(buildDeltaEntry(field, previousValue, nextValue, context))
  }

  return changes
}

function revisionChanges(
  action: string,
  revisionIdValue: unknown,
  revisionIndex: Map<number, RevisionSnapshot>,
  sortedRevisionIds: number[],
  context: FieldDisplayContext,
): ActivityLogDeltaEntry[] {
  if (action === 'create') {
    return createInitialFields(
      revisionIdValue,
      revisionIndex,
      sortedRevisionIds,
      context,
    )
  }

  if (action !== 'update') return []

  const id = revisionId(revisionIdValue)
  if (id === null) return []

  const current = revisionIndex.get(id)
  if (!current) return []

  const parent =
    current.parentId !== null ? revisionIndex.get(current.parentId) : undefined
  if (!parent || !hasComparableSnapshot(parent.data)) return []

  return computeDataDiff(parent.data, current.data, context)
}

function createInitialFields(
  revisionIdValue: unknown,
  revisionIndex: Map<number, RevisionSnapshot>,
  sortedRevisionIds: number[],
  context: FieldDisplayContext,
): ActivityLogDeltaEntry[] {
  const linkedId = revisionId(revisionIdValue)
  let snapshot: Record<string, unknown> | null = null

  if (linkedId !== null) {
    const linked = revisionIndex.get(linkedId)
    if (linked && hasComparableSnapshot(linked.data)) {
      snapshot = linked.data
    } else {
      const startIndex = sortedRevisionIds.indexOf(linkedId)
      const fromIndex = startIndex >= 0 ? startIndex : 0
      for (let index = fromIndex; index < sortedRevisionIds.length; index++) {
        const candidate = revisionIndex.get(sortedRevisionIds[index]!)
        if (candidate && hasComparableSnapshot(candidate.data)) {
          snapshot = candidate.data
          break
        }
      }
    }
  }

  if (!snapshot) {
    for (const id of sortedRevisionIds) {
      const candidate = revisionIndex.get(id)
      if (candidate && hasComparableSnapshot(candidate.data)) {
        snapshot = candidate.data
        break
      }
    }
  }

  if (!snapshot) return []

  const schemaFields = Object.keys(context.labels).filter(
    (field) => !isHiddenDeltaField(field),
  )
  const snapshotFields = Object.keys(snapshot).filter(
    (field) => !isHiddenDeltaField(field),
  )
  const orderedFields = [
    ...schemaFields.filter((field) => snapshotFields.includes(field)),
    ...snapshotFields
      .filter((field) => !schemaFields.includes(field))
      .sort((left, right) => left.localeCompare(right)),
  ]

  return orderedFields
    .filter((field) => hasDisplayValue(snapshot![field]))
    .map((field) => buildDeltaEntry(field, null, snapshot![field], context))
}

function formatDeltaSummary(entry: ActivityLogDeltaEntry): string {
  if (
    entry.previousPreview &&
    entry.previousPreview !== '—' &&
    entry.previousPreview !== entry.valuePreview
  ) {
    return `${entry.label}: ${entry.previousPreview} → ${entry.valuePreview}`
  }

  return `${entry.label}: ${entry.valuePreview}`
}

function summarizeDeltas(deltas: ActivityLogDeltaEntry[]): string {
  if (deltas.length === 0) return ''
  if (deltas.length === 1) {
    return formatDeltaSummary(deltas[0]!)
  }

  const labels = deltas.slice(0, 3).map((entry) => entry.label)
  const remaining = deltas.length - labels.length
  if (remaining > 0) {
    return `${labels.join(', ')} +${remaining}`
  }
  return labels.join(', ')
}

function actionSummary(action: string, deltas: ActivityLogDeltaEntry[]): string {
  if (action === 'create') return ''

  const deltaSummary = summarizeDeltas(deltas)
  if (deltaSummary) return deltaSummary

  switch (action) {
    case 'delete':
      return 'Record deleted'
    case 'update':
      return 'Record updated'
    default:
      return action
  }
}

function shouldSkipCreateTimeUpdate(
  entry: Pick<ActivityLogEntry, 'action' | 'timestampLabel'>,
  createTimestampLabels: Set<string>,
): boolean {
  return entry.action === 'update' && createTimestampLabels.has(entry.timestampLabel)
}

async function buildFieldDisplayContext(
  collection: string,
): Promise<FieldDisplayContext> {
  const [fields, relations] = await Promise.all([
    getCachedCollectionFields(collection),
    getCachedRelations(),
  ])
  const labels: Record<string, string> = {}
  const definitions = new Map<string, FieldDefinition>()
  const userFields = new Set<string>()

  for (const relation of relations) {
    if (
      relation.collection === collection &&
      isUsersAssetCollection(
        String(relation.related_collection || relation.meta?.one_collection || ''),
      )
    ) {
      userFields.add(relation.field)
    }
  }

  await Promise.all(
    fields.map(async (field) => {
      definitions.set(field.field, field)
      labels[field.field] = await translateField(
        { ...field, collection },
        field.meta?.note ?? undefined,
      )
    }),
  )

  return {
    labels,
    definitions,
    userRelationFields: userFields,
    userLabelCache: new Map(),
  }
}

async function populateUserLabelCache(
  context: FieldDisplayContext,
  revisionIndex: Map<number, RevisionSnapshot>,
  activities: Record<string, unknown>[] = [],
): Promise<void> {
  const userIds = new Set<string>()

  if (context.userRelationFields.size > 0) {
    for (const snapshot of revisionIndex.values()) {
      for (const field of context.userRelationFields) {
        const value = snapshot.data[field]
        if (isUuidString(value)) {
          userIds.add(value)
        }
      }
    }
  }

  for (const activity of activities) {
    const user = activity.user
    if (!user || typeof user !== 'object' || Array.isArray(user)) continue
    const id = (user as { id?: unknown }).id
    if (isUuidString(id)) userIds.add(id)
    else if (typeof id === 'string' || typeof id === 'number') {
      userIds.add(String(id))
    }
  }

  if (userIds.size === 0) return

  try {
    const users = await readUsersBridge({
      ids: [...userIds],
      fields: ['id', 'first_name', 'last_name', 'email'],
      limit: userIds.size,
    })

    const usersById = new Map<string, Record<string, unknown>>()
    for (const user of users) {
      const id = user.id
      if (typeof id !== 'string' && typeof id !== 'number') continue
      const key = String(id)
      usersById.set(key, user)
      const label = formatUserLabel(user) || key
      context.userLabelCache.set(key, label)
    }

    for (const activity of activities) {
      const user = activity.user
      if (!user || typeof user !== 'object' || Array.isArray(user)) continue
      const id = (user as { id?: unknown }).id
      if (id === undefined || id === null) continue
      const hydrated = usersById.get(String(id))
      if (hydrated) {
        activity.user = hydrated
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.warn(
      `[activityLogService] Failed to resolve user labels: ${message}`,
      error,
    )
  }
}

async function fetchRevisionIndex(
  collection: string,
  recordId: string | number,
): Promise<{
  index: Map<number, RevisionSnapshot>
  sortedRevisionIds: number[]
}> {
  try {
    const revisions = await readRecordRevisionsBridge({
      entity: collection,
      recordId,
      limit: 500,
    })

    const index = new Map<number, RevisionSnapshot>()
    const sortedEntries: Array<{
      id: number
      data: Record<string, unknown>
      parentId: number | null
    }> = []

    for (const revision of revisions ?? []) {
      const record = revision as Record<string, unknown>
      const id = revisionId(record.id)
      const data = revisionRecord(record.data)
      if (id === null || !data) continue

      sortedEntries.push({
        id,
        data,
        parentId: revisionId(record.parent),
      })
    }

    for (let indexInChain = 0; indexInChain < sortedEntries.length; indexInChain++) {
      const entry = sortedEntries[indexInChain]!
      const chainParentId =
        indexInChain > 0 ? sortedEntries[indexInChain - 1]!.id : null

      index.set(entry.id, {
        data: entry.data,
        parentId: entry.parentId ?? chainParentId,
      })
    }

    return {
      index,
      sortedRevisionIds: sortedEntries.map((entry) => entry.id),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.warn(
      `[activityLogService] Failed to load revisions for ${collection}/${recordId}: ${message}`,
      error,
    )
    return { index: new Map(), sortedRevisionIds: [] }
  }
}

async function readActivityRows(
  options: FetchRecordActivityLogOptions,
  settings: ReturnType<typeof normalizeActivityLogSettings>,
): Promise<Record<string, unknown>[]> {
  return readRecordActivitiesBridge({
    entity: options.collection,
    recordId: options.recordId,
    actions: mapUiActionsToPlatform(settings.actions as ActivityLogAction[]),
    uiActions: settings.actions as ActivityLogAction[],
    limit: settings.maxItems,
    fields: [...ACTIVITY_LOG_FIELDS],
  })
}

export async function fetchRecordActivityLog(
  options: FetchRecordActivityLogOptions,
): Promise<ActivityLogEntry[]> {
  const settings = normalizeActivityLogSettings(options.settings)
  const [fieldContext, revisionState, activities] = await Promise.all([
    buildFieldDisplayContext(options.collection),
    fetchRevisionIndex(options.collection, options.recordId),
    readActivityRows(options, settings),
  ])
  const { index: revisionIndex, sortedRevisionIds } = revisionState

  await populateUserLabelCache(fieldContext, revisionIndex, activities)

  const entries = activities.map((activity) => {
    const record = activity
    const revisions = Array.isArray(record.revisions) ? record.revisions : []
    const action = String(record.action ?? '')
    const deltas = settings.showDeltas
      ? revisions.flatMap((revision) =>
          revisionChanges(
            action,
            (revision as Record<string, unknown>).id,
            revisionIndex,
            sortedRevisionIds,
            fieldContext,
          ),
        )
      : []
    const timestamp = String(record.timestamp ?? '')

    return {
      id: Number(record.id),
      action,
      timestamp,
      timestampLabel: timestamp
        ? formatLocalizedDateTime(timestamp)
        : '—',
      userName: formatActivityUser(record.user as Record<string, unknown> | undefined),
      comment:
        typeof record.comment === 'string' && record.comment.trim()
          ? record.comment
          : null,
      summary: actionSummary(action, deltas),
      deltas,
    }
  })

  const createTimestampLabels = new Set(
    entries
      .filter((entry) => entry.action === 'create')
      .map((entry) => entry.timestampLabel),
  )

  return entries.filter(
    (entry) => !shouldSkipCreateTimeUpdate(entry, createTimestampLabels),
  )
}
