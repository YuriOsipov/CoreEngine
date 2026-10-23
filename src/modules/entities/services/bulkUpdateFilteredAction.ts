import type { ListViewAction } from '@/interfaces'
import { graphqlRequest } from '@/core/graphql/client'

export interface BulkUpdateFilteredResult {
  updatedCount: number
  skippedCount: number
  createdCount?: number
}

const BULK_UPDATE_FILTERED = `
  mutation BulkUpdateFilteredFromAction(
    $collection: String!
    $targetField: String!
    $sourcePath: String!
    $multiplier: Float!
    $formula: String
    $filter: JSON
    $recordIds: [ID!]
  ) {
    bulkUpdateFilteredFromAction(
      collection: $collection
      targetField: $targetField
      sourcePath: $sourcePath
      multiplier: $multiplier
      formula: $formula
      filter: $filter
      recordIds: $recordIds
    ) {
      createdCount
      updatedCount
      skippedCount
    }
  }
`

export async function applyBulkUpdateFilteredAction(
  action: ListViewAction,
  collection: string,
  multiplier: number,
  options: {
    filter?: Record<string, unknown> | null
    recordIds?: string[] | null
  },
): Promise<BulkUpdateFilteredResult> {
  const settings = action.bulkUpdate
  if (!settings) {
    throw new Error('Bulk update settings are missing on this list action.')
  }

  const targetField = settings.targetField?.trim() ?? ''
  const sourcePath = settings.sourcePath?.trim() ?? ''
  const formula = settings.formula?.trim() || '{{source}} * {{prompt}}'

  if (!targetField || !sourcePath) {
    throw new Error('Bulk update requires target field and source path.')
  }
  if (!Number.isFinite(multiplier)) {
    throw new Error('Multiplier must be a finite number.')
  }

  const recordIds = (options.recordIds ?? []).map(String).filter(Boolean)
  const filter =
    recordIds.length > 0
      ? null
      : options.filter && typeof options.filter === 'object'
        ? options.filter
        : null

  if (!recordIds.length && !filter) {
    throw new Error('No records match the current filter.')
  }

  const data = await graphqlRequest<{
    bulkUpdateFilteredFromAction: BulkUpdateFilteredResult
  }>(BULK_UPDATE_FILTERED, {
    collection,
    targetField,
    sourcePath,
    multiplier,
    formula,
    filter,
    recordIds: recordIds.length > 0 ? recordIds : null,
  })

  return data.bulkUpdateFilteredFromAction
}
