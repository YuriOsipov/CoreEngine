import type { DocTemplateRecord, DocTemplateSnapshotRecord } from '@/interfaces'
import {
  bridgeCreateItem,
  bridgeReadItem,
  bridgeReadItems,
  bridgeUpdateItem,
} from '@/core/graphql/itemsBridge'
import {
  DOC_ARCHIVED_FIELD,
  DOC_TEMPLATE_BODY_FIELD,
  DOC_TEMPLATE_SNAPSHOT_COLLECTION,
  DOC_TEMPLATE_SNAPSHOT_FIELDS,
  DOC_VALUE_COLLECTION,
} from '@/interfaces/documents'
import { andFilters, notArchivedFilter } from './docArchiveFilter'
import { loadDocTemplateById } from './docTemplateService'

const DETAIL_FIELDS = [...DOC_TEMPLATE_SNAPSHOT_FIELDS] as const

type DocValueTemplateSnapshotRef =
  | string
  | DocTemplateSnapshotRecord
  | null
  | undefined

function resolveTemplateId(
  template: DocTemplateSnapshotRecord['template'],
): string | null {
  if (!template) return null
  if (typeof template === 'string') return template
  return template.id ? String(template.id) : null
}

/** Directus may return integer fields as strings — coerce before math/sort. */
export function parseSnapshotVersion(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function createdAtMs(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

function normalizeSnapshot(
  row: DocTemplateSnapshotRecord | null | undefined,
): DocTemplateSnapshotRecord | null {
  if (!row) return null
  const version = parseSnapshotVersion(row.version) ?? 0
  return { ...row, version }
}

function sortSnapshotsNewestFirst(
  rows: DocTemplateSnapshotRecord[],
): DocTemplateSnapshotRecord[] {
  return [...rows].sort((a, b) => {
    const byDate = createdAtMs(b.date_created) - createdAtMs(a.date_created)
    if (byDate !== 0) return byDate
    const byVersion =
      (parseSnapshotVersion(b.version) ?? 0) - (parseSnapshotVersion(a.version) ?? 0)
    if (byVersion !== 0) return byVersion
    return String(b.id).localeCompare(String(a.id))
  })
}

function normalizeSnapshots(
  rows: DocTemplateSnapshotRecord[],
): DocTemplateSnapshotRecord[] {
  return sortSnapshotsNewestFirst(
    rows
      .map((row) => normalizeSnapshot(row))
      .filter((row): row is DocTemplateSnapshotRecord => row != null),
  )
}

export async function loadDocTemplateSnapshotById(
  snapshotId: string,
): Promise<DocTemplateSnapshotRecord | null> {
  try {
    const row = (await bridgeReadItem(DOC_TEMPLATE_SNAPSHOT_COLLECTION, snapshotId, {
      fields: [...DETAIL_FIELDS],
    })) as unknown as DocTemplateSnapshotRecord
    return normalizeSnapshot(row)
  } catch {
    return null
  }
}

export async function loadLatestDocTemplateSnapshot(
  templateId: string,
): Promise<DocTemplateSnapshotRecord | null> {
  const records = (await bridgeReadItems(DOC_TEMPLATE_SNAPSHOT_COLLECTION, {
    filter: andFilters(
      { template: { _eq: templateId } },
      notArchivedFilter(),
    ),
    fields: [...DETAIL_FIELDS],
    // Newest save wins — version alone is unreliable when values collide or arrive as strings.
    sort: ['-date_created'],
    limit: 1,
  })) as unknown as DocTemplateSnapshotRecord[]

  return normalizeSnapshot(records[0] ?? null)
}

export async function listDocTemplateSnapshots(
  templateId: string,
): Promise<DocTemplateSnapshotRecord[]> {
  const records = (await bridgeReadItems(DOC_TEMPLATE_SNAPSHOT_COLLECTION, {
    filter: andFilters(
      { template: { _eq: templateId } },
      notArchivedFilter(),
    ),
    fields: [...DETAIL_FIELDS],
    sort: ['-date_created'],
    limit: -1,
  })) as unknown as DocTemplateSnapshotRecord[]

  return normalizeSnapshots(records)
}

async function loadPinnedSnapshotIds(templateId: string): Promise<Set<string>> {
  const rows = (await bridgeReadItems(DOC_VALUE_COLLECTION, {
    filter: andFilters(
      { template: { _eq: templateId } },
      { template_snapshot: { _nnull: true } },
      notArchivedFilter(),
    ),
    fields: ['id', 'template_snapshot', 'template_snapshot.id'],
    limit: -1,
  })) as unknown as Array<{ template_snapshot?: DocValueTemplateSnapshotRef }>

  const pinned = new Set<string>()
  for (const row of rows) {
    const id = resolveDocTemplateSnapshotId(row.template_snapshot)
    if (id) pinned.add(id)
  }
  return pinned
}

/** How many newest snapshots to retain (plus any pinned by documents). */
export const DOC_TEMPLATE_SNAPSHOT_RETENTION = 10

/**
 * Soft-delete old unused snapshots.
 * Keeps the newest {@link DOC_TEMPLATE_SNAPSHOT_RETENTION} versions and any
 * snapshot still referenced by `doc_value`; archives the rest.
 */
export async function pruneUnusedDocTemplateSnapshots(
  templateId: string,
): Promise<{ kept: number; archived: number }> {
  const snapshots = await listDocTemplateSnapshots(templateId)
  if (snapshots.length <= DOC_TEMPLATE_SNAPSHOT_RETENTION) {
    return { kept: snapshots.length, archived: 0 }
  }

  const pinnedIds = await loadPinnedSnapshotIds(templateId)
  const keepIds = new Set<string>()
  for (const snap of snapshots.slice(0, DOC_TEMPLATE_SNAPSHOT_RETENTION)) {
    if (snap.id) keepIds.add(String(snap.id))
  }
  for (const id of pinnedIds) keepIds.add(id)

  let archived = 0
  for (const snap of snapshots) {
    const id = snap.id ? String(snap.id) : ''
    if (!id || keepIds.has(id)) continue
    await bridgeUpdateItem(DOC_TEMPLATE_SNAPSHOT_COLLECTION, id, {
      [DOC_ARCHIVED_FIELD]: true,
    })
    archived += 1
  }

  return { kept: keepIds.size, archived }
}

async function nextSnapshotVersion(templateId: string): Promise<number> {
  // Include archived rows so pruning unused versions does not reuse numbers.
  const records = (await bridgeReadItems(DOC_TEMPLATE_SNAPSHOT_COLLECTION, {
    filter: { template: { _eq: templateId } },
    fields: ['id', 'version'],
    limit: -1,
  })) as unknown as DocTemplateSnapshotRecord[]

  let max = 0
  for (const row of records) {
    const version = parseSnapshotVersion(row?.version)
    if (version != null && version > max) max = version
  }
  return max + 1
}

export async function createDocTemplateSnapshot(input: {
  templateId: string
  body: Record<string, unknown>
  fieldMapping?: Record<string, unknown> | null
}): Promise<DocTemplateSnapshotRecord> {
  const version = await nextSnapshotVersion(input.templateId)
  const created = (await bridgeCreateItem(
    DOC_TEMPLATE_SNAPSHOT_COLLECTION,
    {
      template: input.templateId,
      version,
      [DOC_TEMPLATE_BODY_FIELD]: input.body,
      field_mapping: input.fieldMapping ?? null,
      [DOC_ARCHIVED_FIELD]: false,
    },
    { fields: [...DETAIL_FIELDS] },
  )) as unknown as DocTemplateSnapshotRecord
  return normalizeSnapshot(created) as DocTemplateSnapshotRecord
}

/** After template head save — insert immutable snapshot from current body. */
export async function createSnapshotFromTemplateRecord(
  template: DocTemplateRecord,
): Promise<DocTemplateSnapshotRecord> {
  if (!template.body || typeof template.body !== 'object') {
    throw new Error('Template body is required to create a snapshot.')
  }
  return createDocTemplateSnapshot({
    templateId: String(template.id),
    body: template.body,
    fieldMapping: template.field_mapping ?? null,
  })
}

/**
 * Pin target for Finish: latest snapshot, or create one from live template head.
 */
export async function resolveSnapshotIdForPin(
  templateId: string,
): Promise<string> {
  const latest = await loadLatestDocTemplateSnapshot(templateId)
  if (latest?.id) return String(latest.id)

  const template = await loadDocTemplateById(templateId)
  if (!template?.body) {
    throw new Error('Document template not found for snapshot pin.')
  }
  const created = await createSnapshotFromTemplateRecord(template)
  return String(created.id)
}

export function resolveDocTemplateSnapshotId(
  snapshot: DocValueTemplateSnapshotRef,
): string | null {
  if (!snapshot) return null
  if (typeof snapshot === 'string') return snapshot.trim() || null
  return snapshot.id ? String(snapshot.id) : null
}

export { resolveTemplateId as resolveSnapshotTemplateId }
