/**
 * Server-side DocEngine generateDocument — Phase 0 contract stub (HTTP 501).
 * Population/PDF is not implemented in the BFF yet.
 * Full contract: docs/generate-document-api.md
 */
import type { MeUser } from '../adapters/usersAdapter.js'
import { assertMeEntityPermission } from '../services/rolePermissions.js'

export const DOCUMENTS_GENERATE_STUB_CODE = 'DOCUMENTS_GENERATE_STUB'

export type GenerateDocumentOutputFormat = 'pdf' | 'html'
export type GenerateDocumentStatus = 'draft' | 'completed'
export type GenerateDocumentUpsertMode = 'always_create' | 'update_latest_draft'

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

/**
 * ACL for generate: read the source record's entity + the template, and
 * create on doc_value when persisting. Runs before any population work.
 */
export async function assertGenerateDocumentAllowed(
  me: MeUser,
  parsed: ReturnType<typeof parseGenerateDocumentInput>,
): Promise<void> {
  await assertMeEntityPermission(me, parsed.collectionName, 'read')
  await assertMeEntityPermission(me, 'doc_template', 'read')
  if (parsed.persist) {
    await assertMeEntityPermission(me, 'doc_value', 'create')
  }
}

/**
 * Phase 0 stub — validates input + ACL then fails with a stable stub error.
 * Replace body with populate → persist → render in later phases.
 */
export async function generateDocument(
  me: MeUser,
  input: GenerateDocumentInput,
): Promise<GenerateDocumentResult> {
  const parsed = parseGenerateDocumentInput(input)
  await assertGenerateDocumentAllowed(me, parsed)
  throw new DocumentsGenerateStubError(
    `generateDocument is not implemented yet ` +
      `(Phase 0 stub / ${DOCUMENTS_GENERATE_STUB_CODE}). Requested ${parsed.outputFormat} for ` +
      `${parsed.collectionName}/${parsed.recordId} template=${parsed.templateId}. ` +
      `Interactive DocEngine in the UI works; server generate for n8n is not ready. ` +
      `See docs/generate-document-api.md`,
  )
}
