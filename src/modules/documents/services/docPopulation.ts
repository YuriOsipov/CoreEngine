import {
  applyDocumentValues,
  buildTemplateExport,
  isDocExport,
  normalizeDocumentValues,
} from '@docengine/editor'
import type { DocTemplateRecord } from '@/interfaces'
import {
  applyDocFieldMapping,
  applyDocListFieldMapping,
  fetchDocListMappingPayload,
  fetchDocMappingPayload,
  type DocListFilterMetaBlock,
} from '@/modules/documents/services/docFieldMapping'
import { buildDocSourceSamplePayload } from '@/modules/documents/services/docSourceSamplePayload'
import { buildListFilterMetaBlock } from '@/core/listFilterUtils'
import type { ListFilterCondition } from '@/modules/config/services/listFilterSettings'

export type { DocListFilterMetaBlock }

const SAMPLE_FILTER_META: DocListFilterMetaBlock = {
  Status: 'Sample',
}

export interface PopulatedEditorDocument {
  time: number
  blocks: unknown[]
  fieldSchemas: Record<string, unknown>
  pageSetup: Record<string, unknown>
  fieldsExport: Record<string, unknown>
}

export interface RenderableDocPreview {
  time: number
  blocks: unknown[]
  fieldSchemas: Record<string, unknown>
  pageSetup: Record<string, unknown>
}

function templateShapeFromBody(body: Record<string, unknown>): {
  blocks: unknown[]
  fieldSchemas: Record<string, unknown>
} {
  if (body.kind === 'document') {
    const exported = buildTemplateExport(body as never) as {
      blocks?: unknown[]
      fieldSchemas?: Record<string, unknown>
    }
    return {
      blocks: exported.blocks ?? [],
      fieldSchemas: exported.fieldSchemas ?? {},
    }
  }

  return {
    blocks: (body.blocks as unknown[]) ?? [],
    fieldSchemas: (body.fieldSchemas as Record<string, unknown>) ?? {},
  }
}

/** Structure plus saved field values, ready for HTML preview. */
export function buildRenderableDocument(
  structureBody: Record<string, unknown>,
  savedValues?: Record<string, unknown> | null,
): RenderableDocPreview {
  if (savedValues && isDocExport(savedValues)) {
    return {
      time: typeof savedValues.time === 'number' ? savedValues.time : Date.now(),
      blocks: (savedValues.blocks as unknown[]) ?? [],
      fieldSchemas: (savedValues.fieldSchemas as Record<string, unknown>) ?? {},
      pageSetup: (savedValues.pageSetup as Record<string, unknown>) ?? {},
    }
  }

  const shape = templateShapeFromBody(structureBody)
  const pageSetup = (structureBody.pageSetup as Record<string, unknown>) ?? {}
  if (!savedValues || Object.keys(savedValues).length === 0) {
    return {
      time: Date.now(),
      blocks: shape.blocks,
      fieldSchemas: shape.fieldSchemas,
      pageSetup,
    }
  }

  const values = normalizeDocumentValues(
    savedValues as never,
    shape.blocks as never,
    shape.fieldSchemas as never,
  )
  const merged = applyDocumentValues(
    shape.blocks as never,
    values,
    shape.fieldSchemas as never,
  )

  return {
    time: Date.now(),
    blocks: merged.blocks,
    fieldSchemas: merged.fieldSchemas as Record<string, unknown>,
    pageSetup,
  }
}

/** Builds a headless DocEngine document with values from mapping or saved doc_value. */
export async function buildPopulatedDocument(
  collection: string,
  recordId: string,
  templateRecord: DocTemplateRecord,
  savedValues?: Record<string, unknown> | null,
): Promise<PopulatedEditorDocument> {
  const body = templateRecord.body
  const mappingTemplate = templateShapeFromBody(body)
  const pageSetup = (body.pageSetup as Record<string, unknown>) ?? {}

  if (savedValues && Object.keys(savedValues).length > 0) {
    const blocks = mappingTemplate.blocks as never
    const fieldSchemas = mappingTemplate.fieldSchemas as never
    const values = normalizeDocumentValues(savedValues as never, blocks, fieldSchemas)
    const merged = applyDocumentValues(blocks, values, fieldSchemas)

    return {
      time: Date.now(),
      blocks: merged.blocks,
      fieldSchemas: merged.fieldSchemas as Record<string, unknown>,
      pageSetup,
      fieldsExport: savedValues,
    }
  }

  const mapping = templateRecord.field_mapping
  if (!mapping || typeof mapping !== 'object' || Object.keys(mapping).length === 0) {
    return {
      time: Date.now(),
      blocks: mappingTemplate.blocks,
      fieldSchemas: mappingTemplate.fieldSchemas,
      pageSetup,
      fieldsExport: {},
    }
  }

  const payload = await fetchDocMappingPayload(
    collection,
    recordId,
    mapping as Record<string, unknown>,
  )
  const mapped = await applyDocFieldMapping(
    collection,
    mapping as Record<string, unknown>,
    payload,
    mappingTemplate,
  )

  return {
    time: Date.now(),
    blocks: mapped.blocks as unknown[],
    fieldSchemas: mapped.fieldSchemas as Record<string, unknown>,
    pageSetup,
    fieldsExport: mapped.fieldsExport as unknown as Record<string, unknown>,
  }
}

export const DOC_LIST_REPORT_MAX_RECORDS = 200

/** One DocEngine document from many list rows (`$payload.records`). */
export async function buildPopulatedDocumentFromList(
  collection: string,
  recordIds: string[],
  templateRecord: DocTemplateRecord,
  meta?: {
    filter?: DocListFilterMetaBlock | null
    parent?: Record<string, unknown> | null
    viewLabel?: string | null
  },
): Promise<PopulatedEditorDocument> {
  const body = templateRecord.body
  const mappingTemplate = templateShapeFromBody(body)
  const pageSetup = (body.pageSetup as Record<string, unknown>) ?? {}

  const mapping = templateRecord.field_mapping
  if (!mapping || typeof mapping !== 'object' || Object.keys(mapping).length === 0) {
    return {
      time: Date.now(),
      blocks: mappingTemplate.blocks,
      fieldSchemas: mappingTemplate.fieldSchemas,
      pageSetup,
      fieldsExport: {},
    }
  }

  const cappedIds = recordIds.slice(0, DOC_LIST_REPORT_MAX_RECORDS)
  const listPayload = await fetchDocListMappingPayload(
    collection,
    cappedIds,
    mapping as Record<string, unknown>,
    meta,
  )
  const mapped = await applyDocListFieldMapping(
    collection,
    mapping as Record<string, unknown>,
    listPayload,
    mappingTemplate,
  )

  return {
    time: Date.now(),
    blocks: mapped.blocks as unknown[],
    fieldSchemas: mapped.fieldSchemas as Record<string, unknown>,
    pageSetup,
    fieldsExport: mapped.fieldsExport as unknown as Record<string, unknown>,
  }
}

/** Design-time sample: `{ records: [sample], meta }` for list report mappings. */
export async function buildDocListSourceSamplePayload(
  collection: string,
  options: {
    maxDepth?: number
    viewLabel?: string | null
    filter?: DocListFilterMetaBlock | null
    filterConditions?: ListFilterCondition[] | null
    /** When set (related-list designer), sample includes `meta.parent` instead of `meta.filter`. */
    parentCollection?: string | null
  } = {},
): Promise<Record<string, unknown>> {
  const row = await buildDocSourceSamplePayload(collection, {
    maxDepth: options.maxDepth,
  })

  const parentCollection = options.parentCollection?.trim() || ''
  if (parentCollection) {
    const parent = await buildDocSourceSamplePayload(parentCollection, {
      maxDepth: options.maxDepth,
      excludeRelatedCollections: [collection],
    })
    return {
      records: [row],
      meta: {
        collection,
        count: 1,
        generatedAt: new Date().toISOString(),
        parent,
        viewLabel: options.viewLabel?.trim() || 'Sample list',
      },
    }
  }

  let filter = options.filter ?? null
  if (
    (!filter || Object.keys(filter).length === 0) &&
    options.filterConditions?.length
  ) {
    filter = await buildListFilterMetaBlock(collection, options.filterConditions)
  }
  // Keep an illustrative key only when the current view has no filter criteria.
  if (!filter || Object.keys(filter).length === 0) {
    filter = SAMPLE_FILTER_META
  }

  return {
    records: [row],
    meta: {
      collection,
      count: 1,
      generatedAt: new Date().toISOString(),
      filter,
      viewLabel: options.viewLabel?.trim() || 'Sample list',
    },
  }
}
