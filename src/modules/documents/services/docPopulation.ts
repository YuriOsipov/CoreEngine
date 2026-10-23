import {
  applyDocumentValues,
  buildTemplateExport,
  isDocExport,
  isSectionInstanceArray,
  normalizeDocumentValues,
  stripValuesFromBlocks,
} from '@docengine/editor'
import type { DocTemplateRecord } from '@/interfaces'
import {
  applyDocFieldMapping,
  applyDocListFieldMapping,
  fetchDocListMappingPayload,
  fetchDocMappingPayload,
  type DocListFilterMetaBlock,
} from '@/modules/documents/services/docFieldMapping'
import {
  attachItemGroupPriceTreeSample,
  buildDocSourceSamplePayload,
  stripItemGroupTreeKeysFromSample,
} from '@/modules/documents/services/docSourceSamplePayload'
import {
  buildListFilterMetaBlock,
  mergeTreeGroupIntoListFilterMeta,
} from '@/core/listFilterUtils'
import type { ListFilterCondition } from '@/modules/config/services/listFilterSettings'
import { loadTreeTableSettings } from '@/modules/entities/services/treeTableSettings'

export type { DocListFilterMetaBlock }

export interface PopulatedEditorDocument {
  time: number
  blocks: unknown[]
  fieldSchemas: Record<string, unknown>
  pageSetup: Record<string, unknown>
  fieldsExport: Record<string, unknown>
  /**
   * `fieldsExport.sections` — required by HTML/PDF preview so array-sourced
   * sections (`$payload.item_group_tree_rows`) clone once per group instance.
   * Without this, preview only shows the first mapped group.
   */
  sections?: Record<string, unknown>
  /** Same arrays keyed for PDF multipage / HTML `resolvePreviewRepeatPlan`. */
  repeatableSectionInstances?: Record<string, unknown[]>
}

export interface RenderableDocPreview {
  time: number
  blocks: unknown[]
  fieldSchemas: Record<string, unknown>
  pageSetup: Record<string, unknown>
  sections?: Record<string, unknown>
  repeatableSectionInstances?: Record<string, unknown[]>
}

/**
 * Attach section instance arrays from a FieldsExport so DocEngine preview/PDF
 * can expand `_source: $payload.item_group_tree_rows` (Group + `$children` table)
 * once per row — matching Field Mapping designer.
 */
export function previewExtrasFromFieldsExport(
  fieldsExport: Record<string, unknown> | null | undefined,
): Pick<PopulatedEditorDocument, 'sections' | 'repeatableSectionInstances'> {
  const raw = fieldsExport?.sections
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const sections = raw as Record<string, unknown>
  const repeatableSectionInstances: Record<string, unknown[]> = {}
  for (const [name, value] of Object.entries(sections)) {
    if (isSectionInstanceArray(value) && value.length > 0) {
      repeatableSectionInstances[name] = value as unknown[]
    }
  }
  return {
    sections,
    ...(Object.keys(repeatableSectionInstances).length > 0
      ? { repeatableSectionInstances }
      : {}),
  }
}

function templateShapeFromBody(body: Record<string, unknown>): {
  blocks: unknown[]
  fieldSchemas: Record<string, unknown>
} {
  // Always strip design-time field values (Apply to editor / sample fill).
  // Otherwise list reports keep stale sample text like "Product" / "test".
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

  const fieldSchemas = (body.fieldSchemas as Record<string, unknown>) ?? {}
  const blocks = stripValuesFromBlocks(
    ((body.blocks as unknown[]) ?? []) as never,
    fieldSchemas as never,
  )
  return { blocks, fieldSchemas }
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
      ...previewExtrasFromFieldsExport(savedValues),
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

  const fieldsExport = mapped.fieldsExport as unknown as Record<string, unknown>
  return {
    time: Date.now(),
    blocks: mapped.blocks as unknown[],
    fieldSchemas: mapped.fieldSchemas as Record<string, unknown>,
    pageSetup,
    fieldsExport,
    ...previewExtrasFromFieldsExport(fieldsExport),
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

  const fieldsExport = mapped.fieldsExport as unknown as Record<string, unknown>
  return {
    time: Date.now(),
    blocks: mapped.blocks as unknown[],
    fieldSchemas: mapped.fieldSchemas as Record<string, unknown>,
    pageSetup,
    fieldsExport,
    ...previewExtrasFromFieldsExport(fieldsExport),
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
    /**
     * When true (default), attach virtual `item_group_tree*` at payload root for Tree mode
     * Field Mapping (`$payload.item_group_tree`, `_rows`, `_sections`).
     */
    includeTreeSample?: boolean
  } = {},
): Promise<Record<string, unknown>> {
  const rawRow = await buildDocSourceSamplePayload(collection, {
    maxDepth: options.maxDepth,
  })
  // Tree keys belong at list payload root, not on each record sample.
  const row = stripItemGroupTreeKeysFromSample(rawRow)

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
  // Only List layout Filter conditions (via list-action Template) populate meta.filter.
  // No placeholder keys when designing from Document Templates or an unfiltered view.
  if (!filter || Object.keys(filter).length === 0) {
    filter = {}
  }

  // Tree sample on: show Group sample key. Off / table-mode design: Group is null.
  try {
    const tree = await loadTreeTableSettings(collection)
    const groupField = tree?.main?.groupField?.trim() || ''
    if (groupField) {
      filter = await mergeTreeGroupIntoListFilterMeta(filter, {
        collection,
        groupField,
        ...(options.includeTreeSample !== false
          ? { groupLabel: 'Sample', fallbackLabel: 'Sample' }
          : { clear: true }),
      })
    }
  } catch {
    // Collection may have no Tree layout.
  }

  const payload: Record<string, unknown> = {
    records: [row],
    meta: {
      collection,
      count: 1,
      generatedAt: new Date().toISOString(),
      filter,
      viewLabel: options.viewLabel?.trim() || 'Sample list',
    },
  }

  if (options.includeTreeSample !== false) {
    await attachItemGroupPriceTreeSample(collection, payload, {
      maxDepth: options.maxDepth,
    })
  }

  return payload
}
