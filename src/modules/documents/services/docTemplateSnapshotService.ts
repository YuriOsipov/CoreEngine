import type { DocTemplateRecord, DocTemplateSnapshotRecord } from '@/interfaces'
import {
  bridgeCreateItem,
  bridgeReadItem,
  bridgeReadItems,
} from '@/core/graphql/itemsBridge'
import {
  DOC_ARCHIVED_FIELD,
  DOC_TEMPLATE_BODY_FIELD,
  DOC_TEMPLATE_SNAPSHOT_COLLECTION,
  DOC_TEMPLATE_SNAPSHOT_FIELDS,
} from '@/interfaces/documents'
import { andFilters, notArchivedFilter } from './docArchiveFilter'
import { loadDocTemplateById } from './docTemplateService'

const DETAIL_FIELDS = [...DOC_TEMPLATE_SNAPSHOT_FIELDS] as const

function resolveTemplateId(
  template: DocTemplateSnapshotRecord['template'],
): string | null {
  if (!template) return null
  if (typeof template === 'string') return template
  return template.id ? String(template.id) : null
}

export async function loadDocTemplateSnapshotById(
  snapshotId: string,
): Promise<DocTemplateSnapshotRecord | null> {
  try {
    return (await bridgeReadItem(DOC_TEMPLATE_SNAPSHOT_COLLECTION, snapshotId, {
      fields: [...DETAIL_FIELDS],
    })) as unknown as DocTemplateSnapshotRecord
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
    sort: ['-version'],
    limit: 1,
  })) as unknown as DocTemplateSnapshotRecord[]

  return records[0] ?? null
}

export async function listDocTemplateSnapshots(
  templateId: string,
): Promise<DocTemplateSnapshotRecord[]> {
  return (await bridgeReadItems(DOC_TEMPLATE_SNAPSHOT_COLLECTION, {
    filter: andFilters(
      { template: { _eq: templateId } },
      notArchivedFilter(),
    ),
    fields: [...DETAIL_FIELDS],
    sort: ['-version'],
    limit: -1,
  })) as unknown as DocTemplateSnapshotRecord[]
}

async function nextSnapshotVersion(templateId: string): Promise<number> {
  const latest = await loadLatestDocTemplateSnapshot(templateId)
  const current = latest?.version
  return typeof current === 'number' && Number.isFinite(current) ? current + 1 : 1
}

export async function createDocTemplateSnapshot(input: {
  templateId: string
  body: Record<string, unknown>
  fieldMapping?: Record<string, unknown> | null
}): Promise<DocTemplateSnapshotRecord> {
  const version = await nextSnapshotVersion(input.templateId)
  return (await bridgeCreateItem(
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

type DocValueTemplateSnapshotRef =
  | string
  | DocTemplateSnapshotRecord
  | null
  | undefined

export { resolveTemplateId as resolveSnapshotTemplateId }
