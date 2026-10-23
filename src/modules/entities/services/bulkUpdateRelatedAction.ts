import type { EntityAction } from '@/interfaces'
import { graphqlRequest } from '@/core/graphql/client'

export interface BulkUpdateRelatedResult {
  createdCount: number
  updatedCount: number
  skippedCount: number
}

const BULK_UPDATE_RELATED = `
  mutation BulkUpdateRelatedFromAction(
    $collection: String!
    $recordId: ID!
    $relatedCollection: String!
    $targetField: String!
    $sourcePath: String!
    $multiplier: Float!
    $formula: String
    $sourceCollection: String
    $sourceLinkField: String
    $activeSourcesOnly: Boolean
  ) {
    bulkUpdateRelatedFromAction(
      collection: $collection
      recordId: $recordId
      relatedCollection: $relatedCollection
      targetField: $targetField
      sourcePath: $sourcePath
      multiplier: $multiplier
      formula: $formula
      sourceCollection: $sourceCollection
      sourceLinkField: $sourceLinkField
      activeSourcesOnly: $activeSourcesOnly
    ) {
      createdCount
      updatedCount
      skippedCount
    }
  }
`

export async function applyBulkUpdateRelatedAction(
  action: EntityAction,
  collection: string,
  recordId: string,
  multiplier: number,
): Promise<BulkUpdateRelatedResult> {
  const settings = action.bulkUpdateRelated
  if (!settings) {
    throw new Error('Bulk update related settings are missing on this action.')
  }

  const relatedCollection = settings.relatedCollection?.trim() ?? ''
  const targetField = settings.targetField?.trim() ?? ''
  const sourcePath = settings.sourcePath?.trim() ?? ''
  const formula = settings.formula?.trim() || '{{source}} * {{prompt}}'
  const sourceCollection = settings.sourceCollection?.trim() ?? ''
  const sourceLinkField = settings.sourceLinkField?.trim() ?? ''

  if (!relatedCollection || !targetField || !sourcePath) {
    throw new Error(
      'Bulk update related action requires related collection, target field, and source path.',
    )
  }
  if (sourceCollection && !sourceLinkField) {
    throw new Error(
      'Bulk update related upsert requires source link field when source collection is set.',
    )
  }
  if (!Number.isFinite(multiplier)) {
    throw new Error('Multiplier must be a finite number.')
  }

  const data = await graphqlRequest<{
    bulkUpdateRelatedFromAction: BulkUpdateRelatedResult
  }>(BULK_UPDATE_RELATED, {
    collection,
    recordId,
    relatedCollection,
    targetField,
    sourcePath,
    multiplier,
    formula,
    sourceCollection: sourceCollection || null,
    sourceLinkField: sourceLinkField || null,
    activeSourcesOnly: sourceCollection
      ? settings.activeSourcesOnly !== false
      : null,
  })

  return data.bulkUpdateRelatedFromAction
}
