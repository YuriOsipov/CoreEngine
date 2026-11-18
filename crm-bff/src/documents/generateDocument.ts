/**
 * Server-side DocEngine generateDocument — Phase 1 populate + persist,
 * Phase 2 PDF/HTML render + upload via @docengine/pdf-renderer.
 * Full contract: docs/generate-document-api.md
 */
import {
  createRecord,
  findManyRecords,
  findOneRecord,
  updateRecord,
  SYSTEM_RECORD_ACCESS,
} from '../adapters/records/facade.js'
import { uploadFileBuffer } from '../adapters/filesAdapter.js'
import type { MeUser } from '../adapters/usersAdapter.js'
import { assertMeEntityPermission } from '../services/rolePermissions.js'
import {
  resolveFieldAccess,
  type FieldAccess,
} from '../services/fieldSecurity.js'
import { renderDocumentOutput } from './renderDocumentOutput.js'

export const DOCUMENTS_GENERATE_STUB_CODE = 'DOCUMENTS_GENERATE_STUB'

export type GenerateDocumentOutputFormat = 'pdf' | 'html'
export type GenerateDocumentStatus = 'draft' | 'completed'
export type GenerateDocumentUpsertMode = 'always_create' | 'update_latest_draft'

/** @deprecated Phase 1 no longer throws this for populate/persist; kept for clients. */
export class DocumentsGenerateStubError extends Error {
  readonly code = DOCUMENTS_GENERATE_STUB_CODE
  readonly statusCode = 501

  constructor(message: string) {
    super(message)
    this.name = 'DocumentsGenerateStubError'
  }
}

export interface GenerateDocumentInput {
  collectionName: string
  recordId: string
  templateId: string
  outputFormat?: string | null
  documentStatus?: string | null
  persist?: boolean | null
  renderOutput?: boolean | null
  valuesOverride?: Record<string, unknown> | null
  upsertMode?: string | null
}

export interface GenerateDocumentResult {
  docValueId: string | null
  templateId: string
  templateSnapshotId: string | null
  collectionName: string
  recordId: string
  documentStatus: GenerateDocumentStatus
  outputFormat: GenerateDocumentOutputFormat
  outputFileId: string | null
  downloadUrl: string | null
  values: Record<string, unknown> | null
}

function normalizeOutputFormat(raw: unknown): GenerateDocumentOutputFormat {
  return String(raw || 'pdf').trim().toLowerCase() === 'html' ? 'html' : 'pdf'
}

function normalizeStatus(raw: unknown): GenerateDocumentStatus {
  return String(raw || 'completed').trim().toLowerCase() === 'draft'
    ? 'draft'
    : 'completed'
}

function normalizeUpsertMode(raw: unknown): GenerateDocumentUpsertMode {
  return String(raw || 'always_create').trim().toLowerCase() === 'update_latest_draft'
    ? 'update_latest_draft'
    : 'always_create'
}

export function parseGenerateDocumentInput(
  input: GenerateDocumentInput,
): {
  collectionName: string
  recordId: string
  templateId: string
  outputFormat: GenerateDocumentOutputFormat
  documentStatus: GenerateDocumentStatus
  persist: boolean
  renderOutput: boolean
  valuesOverride: Record<string, unknown>
  upsertMode: GenerateDocumentUpsertMode
} {
  const collectionName = String(input.collectionName || '').trim()
  const recordId = String(input.recordId || '').trim()
  const templateId = String(input.templateId || '').trim()
  if (!collectionName) throw new Error('collectionName is required')
  if (!recordId) throw new Error('recordId is required')
  if (!templateId) throw new Error('templateId is required')

  const valuesOverride =
    input.valuesOverride &&
    typeof input.valuesOverride === 'object' &&
    !Array.isArray(input.valuesOverride)
      ? input.valuesOverride
      : {}

  return {
    collectionName,
    recordId,
    templateId,
    outputFormat: normalizeOutputFormat(input.outputFormat),
    documentStatus: normalizeStatus(input.documentStatus),
    persist: input.persist !== false,
    renderOutput: input.renderOutput !== false,
    valuesOverride,
    upsertMode: normalizeUpsertMode(input.upsertMode),
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean)
  let cur: unknown = source
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function mappingEntries(fieldMapping: unknown): Array<{
  target: string
  path: string
}> {
  const mapping = asObject(fieldMapping)
  const raw = Array.isArray(mapping.fields)
    ? (mapping.fields as unknown[])
    : Array.isArray(mapping.mappings)
      ? (mapping.mappings as unknown[])
      : Object.entries(mapping).map(([target, source]) => ({
          target,
          source,
          path: source,
        }))
  const out: Array<{ target: string; path: string }> = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const target = String(row.target ?? row.key ?? row.name ?? '').trim()
    const path = String(
      row.path ?? row.source ?? row.field ?? row.value ?? '',
    ).trim()
    if (!target || !path) continue
    if (path.startsWith('$') || path.includes('{{')) continue
    out.push({ target, path: path.replace(/^\$payload\.?/, '') })
  }
  return out
}

function pathRoot(path: string): string {
  return path.split('.')[0]?.trim() || ''
}

/**
 * Drop override keys that would reintroduce fields the caller cannot read
 * (direct field names, or mapping targets whose source path is unreadable).
 * Freeform automation keys that are not source fields / mapping targets stay.
 */
export function filterValuesOverrideForFieldAccess(
  valuesOverride: Record<string, unknown>,
  fieldMapping: unknown,
  access: FieldAccess | null,
): Record<string, unknown> {
  if (!access?.unreadable.size) return valuesOverride
  const blockedTargets = new Set<string>()
  for (const { target, path } of mappingEntries(fieldMapping)) {
    const root = pathRoot(path)
    if (root && access.unreadable.has(root)) blockedTargets.add(target)
  }
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(valuesOverride)) {
    if (access.unreadable.has(key) || blockedTargets.has(key)) continue
    next[key] = value
  }
  return next
}

/**
 * Phase 1 mapping: flatten scalar/M2O-id fields from the source record, then
 * overlay template field_mapping path → value pairs and caller overrides.
 * Full DocEngine applyFieldMapping (HTML body fill) stays client-side until Phase 2.
 */
export function buildGenerateDocumentValues(
  record: Record<string, unknown>,
  fieldMapping: unknown,
  valuesOverride: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('_')) continue
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      const id = (value as { id?: unknown }).id
      values[key] = id != null ? id : value
    } else {
      values[key] = value
    }
  }

  for (const { target, path } of mappingEntries(fieldMapping)) {
    const resolved = getPathValue(record, path)
    if (resolved !== undefined) values[target] = resolved
  }

  return { ...values, ...valuesOverride }
}

function buildDocValueParentPayload(
  collectionName: string,
  recordId: string,
): Record<string, string> {
  return {
    parent_collection: collectionName,
    parent_id: String(recordId).trim(),
  }
}

async function resolveTemplateSnapshotId(
  templateId: string,
): Promise<string | null> {
  try {
    const listed = await findManyRecords('doc_template_snapshot', {
      filter: { template: { _eq: templateId } },
      fields: ['id'],
      sort: ['-date_created', '-id'],
      limit: 1,
      access: SYSTEM_RECORD_ACCESS,
    })
    const id = listed.nodes[0]?.id
    return id == null ? null : String(id)
  } catch {
    return null
  }
}

/**
 * ACL for generate:
 * - read (+ update when persisting) on the source entity
 * - source row must pass owner RLS (findOneRecord with { me })
 * - template must exist
 */
export async function assertGenerateDocumentAllowed(
  me: MeUser,
  parsed: ReturnType<typeof parseGenerateDocumentInput>,
): Promise<void> {
  await assertMeEntityPermission(me, parsed.collectionName, 'read')
  if (parsed.persist) {
    await assertMeEntityPermission(me, parsed.collectionName, 'update')
  }

  try {
    await findOneRecord(
      parsed.collectionName,
      parsed.recordId,
      ['id'],
      { me },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not found|permission denied/i.test(message)) {
      throw new Error(
        `Permission denied or record not found: ${parsed.collectionName}/${parsed.recordId}`,
      )
    }
    throw error
  }

  try {
    await findOneRecord(
      'doc_template',
      parsed.templateId,
      ['id'],
      SYSTEM_RECORD_ACCESS,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not found/i.test(message)) {
      throw new Error(`Template not found: ${parsed.templateId}`)
    }
    throw error
  }
}

function buildDownloadUrl(fileId: string): string {
  return `/assets/${fileId}`
}

/**
 * Phase 1 — populate values + persist doc_value.
 * Phase 2 — when renderOutput=true, render PDF/HTML from template.body + values,
 * upload via files pipeline, set doc_value.output_file, return downloadUrl.
 */
export async function generateDocument(
  me: MeUser,
  input: GenerateDocumentInput,
): Promise<GenerateDocumentResult> {
  const parsed = parseGenerateDocumentInput(input)
  await assertGenerateDocumentAllowed(me, parsed)
  const access = { me }

  const template = await findOneRecord(
    'doc_template',
    parsed.templateId,
    ['id', 'name', 'collection', 'field_mapping', 'body'],
    SYSTEM_RECORD_ACCESS,
  )
  const templateCollection = String(template.collection || '').trim()
  if (
    templateCollection &&
    templateCollection.toLowerCase() !== parsed.collectionName.toLowerCase()
  ) {
    throw new Error(
      `Template collection mismatch: template is for ${templateCollection}, ` +
        `requested ${parsed.collectionName}`,
    )
  }

  const record = await findOneRecord(
    parsed.collectionName,
    parsed.recordId,
    null,
    access,
  )
  const fieldAccess = await resolveFieldAccess(me, parsed.collectionName)
  const safeOverride = filterValuesOverrideForFieldAccess(
    parsed.valuesOverride,
    template.field_mapping,
    fieldAccess,
  )
  const values = buildGenerateDocumentValues(
    record,
    template.field_mapping,
    safeOverride,
  )
  const templateSnapshotId = await resolveTemplateSnapshotId(parsed.templateId)
  const documentTitle =
    String(template.name || '').trim() ||
    `${parsed.collectionName} document`

  let outputFileId: string | null = null
  let downloadUrl: string | null = null
  if (parsed.renderOutput) {
    try {
      const rendered = await renderDocumentOutput({
        templateBody: template.body,
        values,
        outputFormat: parsed.outputFormat,
        title: documentTitle,
      })
      const uploaded = await uploadFileBuffer({
        filename: rendered.filename,
        mimeType: rendered.mimeType,
        buffer: rendered.buffer,
        title: documentTitle,
        uploadedBy: me.id,
        parentCollection: parsed.collectionName,
        parentRecordId: parsed.recordId,
      })
      const id = uploaded.id
      if (id == null || String(id).trim() === '') {
        throw new Error('File upload did not return an id')
      }
      outputFileId = String(id)
      downloadUrl = buildDownloadUrl(outputFileId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/Cannot find module|ERR_MODULE_NOT_FOUND|@docengine/i.test(message)) {
        throw new DocumentsGenerateStubError(
          'Document PDF/HTML render requires @docengine/pdf-renderer ' +
            '(clone sibling ../docEngine next to coreEngine)',
        )
      }
      throw error
    }
  }

  let docValueId: string | null = null
  if (parsed.persist) {
    const parent = buildDocValueParentPayload(
      parsed.collectionName,
      parsed.recordId,
    )
    const payload: Record<string, unknown> = {
      ...parent,
      template: parsed.templateId,
      template_snapshot: templateSnapshotId,
      values,
      document_status: parsed.documentStatus,
      name: documentTitle,
    }
    if (outputFileId) {
      payload.output_file = outputFileId
    }
    if (parsed.documentStatus === 'completed') {
      payload.completed_date = new Date().toISOString()
    }

    // doc_value is matrix-restricted (often admin-only); persist as system after
    // the caller already passed source-record read/update + owner RLS.
    if (parsed.upsertMode === 'update_latest_draft') {
      const existing = await findManyRecords('doc_value', {
        filter: {
          _and: [
            { parent_collection: { _eq: parsed.collectionName } },
            { parent_id: { _eq: parsed.recordId } },
            { template: { _eq: parsed.templateId } },
            { document_status: { _eq: 'draft' } },
          ],
        },
        fields: ['id'],
        sort: ['-date_created', '-id'],
        limit: 1,
        access: SYSTEM_RECORD_ACCESS,
      })
      const existingId = existing.nodes[0]?.id
      if (existingId != null) {
        const updated = await updateRecord(
          'doc_value',
          String(existingId),
          payload,
          ['id'],
          { access: SYSTEM_RECORD_ACCESS },
        )
        docValueId = String(updated.id ?? existingId)
      } else {
        const created = await createRecord('doc_value', payload, ['id'], {
          access: SYSTEM_RECORD_ACCESS,
        })
        docValueId = created.id == null ? null : String(created.id)
      }
    } else {
      const created = await createRecord('doc_value', payload, ['id'], {
        access: SYSTEM_RECORD_ACCESS,
      })
      docValueId = created.id == null ? null : String(created.id)
    }
  }

  return {
    docValueId,
    templateId: parsed.templateId,
    templateSnapshotId,
    collectionName: parsed.collectionName,
    recordId: parsed.recordId,
    documentStatus: parsed.documentStatus,
    outputFormat: parsed.outputFormat,
    outputFileId,
    downloadUrl,
    values,
  }
}
