import type { RelationDefinition } from '@/interfaces'
import {
  keysEqual,
  relatedCollectionForCollectionField,
  relationField,
  relationManyCollection,
  relationRelatedCollection,
} from '@/core/relationHelpers'
import { resolveRelatedTransferFilter } from '@/core/relatedTransferResolver'
import { getCachedCollectionFields, getCachedRelations } from '@/modules/entities/services/collectionSchema'
import { enrichedParentRecordForLookup } from '@/modules/entities/services/relatedTransferData'
import type { RelatedTransferDataContext } from '@/modules/entities/services/relatedTransferData'
import { readRelatedTransferItems } from '@/modules/entities/services/relatedTransfer'
import { lookupFilterTokens } from '@/modules/entities/utils/relatedTransferFilters'
import { scalarId } from '@/modules/entities/utils/recordDisplay'

export interface ChildLookupFilterContext {
  parentRecord: Record<string, unknown>
  sourceRecord: Record<string, unknown>
  parentId?: string | number
  sourcePrimaryKey?: string
}

export async function resolveChildLookupFilterContext(options: {
  filter: Record<string, unknown> | null | undefined
  entityCollection: string
  sourceRecord: Record<string, unknown>
  parentCollection?: string
  parentId?: string | number
  parentName?: string
  parentRecord?: Record<string, unknown>
  entityParentField?: string
  sourcePrimaryKey?: string
}): Promise<ChildLookupFilterContext> {
  const sourceRecord = options.sourceRecord
  let parentRecord: Record<string, unknown> = options.parentRecord
    ? { ...options.parentRecord }
    : {}
  let parentId = options.parentId
  let parentCollection = options.parentCollection ?? ''
  let parentField = options.parentName || options.entityParentField || ''

  const relations = await getCachedRelations() as RelationDefinition[]

  if (!parentField && options.entityCollection) {
    const parentRelations = relations.filter((relation) =>
      keysEqual(relationManyCollection(relation), options.entityCollection) &&
      Boolean(relationRelatedCollection(relation)),
    )
    const preferredRelation = options.entityParentField
      ? parentRelations.find((relation) =>
          keysEqual(relationField(relation), options.entityParentField ?? ''),
        )
      : parentRelations[0]
    if (preferredRelation) {
      parentField = relationField(preferredRelation)
      if (!parentCollection) {
        parentCollection = relationRelatedCollection(preferredRelation)
      }
    }
  }

  if ((parentId === undefined || parentId === null) && parentField) {
    const raw = sourceRecord[parentField]
    const resolvedId = scalarId(raw)
    if (resolvedId !== null) {
      parentId = resolvedId
    }
    if (!parentCollection && options.entityCollection) {
      parentCollection = relatedCollectionForCollectionField(
        relations,
        options.entityCollection,
        parentField,
      )
    }
  }

  if (!parentField && options.parentName) {
    parentField = options.parentName
    if (!parentCollection && options.entityCollection) {
      parentCollection = relatedCollectionForCollectionField(
        relations,
        options.entityCollection,
        parentField,
      )
    }
  }

  const parentTokens = lookupFilterTokens(options.filter ?? {}).filter((token) =>
    token.startsWith('$parent.'),
  )
  const hasParentTokens = parentTokens.length > 0

  // Only fetch the parent record when the filter actually references $parent.* —
  // otherwise every inline/form open paid for a deep `*.*` parent read for no reason.
  if (
    hasParentTokens &&
    parentId !== undefined &&
    parentId !== null &&
    parentCollection
  ) {
    const fields = await getCachedCollectionFields(parentCollection)
    const primaryKey = fields?.find((field) => field.schema?.is_primary_key)?.field ?? 'id'
    const hasLoadedParentRecord = Object.keys(parentRecord).some((key) =>
      key !== primaryKey && key !== 'id',
    )
    if (!hasLoadedParentRecord) {
      const tokenFields = parentTokens
        .map((token) => token.slice('$parent.'.length).trim())
        .filter(Boolean)
      const needsNested = tokenFields.some((field) => field.includes('.'))
      try {
        const rows = await readRelatedTransferItems(parentCollection, {
          limit: 1,
          fields: (needsNested
            ? ['*', '*.*']
            : Array.from(new Set([primaryKey, 'id', ...tokenFields]))
          ) as never,
          filter: {
            [primaryKey]: { _eq: parentId },
          },
        })
        parentRecord = rows[0] ? { ...rows[0] } : { [primaryKey]: parentId, id: parentId }
      } catch {
        parentRecord = { [primaryKey]: parentId, id: parentId }
      }
    }
  } else if (
    parentId !== undefined &&
    parentId !== null &&
    Object.keys(parentRecord).length === 0
  ) {
    parentRecord = { id: parentId }
  }

  if (hasParentTokens && parentCollection) {
    const ctx: RelatedTransferDataContext = {
      t: (key) => key,
      parentRecord,
      parentId,
      parentCollection,
      resolvedTargetParentField: parentField,
      targetParentField: parentField,
      sourcePrimaryKey: options.sourcePrimaryKey ?? 'id',
      lookupRowsByTargetField: new Map(),
    }
    parentRecord = await enrichedParentRecordForLookup(options.filter, ctx)
  }

  return {
    parentRecord,
    sourceRecord,
    parentId,
    sourcePrimaryKey: options.sourcePrimaryKey,
  }
}

export function resolveChildLookupExtraFilter(
  filter: Record<string, unknown> | null | undefined,
  context: ChildLookupFilterContext,
): Record<string, unknown> | null {
  return resolveRelatedTransferFilter(filter, {
    parentRecord: context.parentRecord,
    parentId: context.parentId,
    sourceRecord: context.sourceRecord,
    sourcePrimaryKey: context.sourcePrimaryKey,
  })
}
