import { bridgeReadItems } from '@/core/graphql/itemsBridge'
import {
  canReadEntity,
  ensureEntityPermissions,
} from '@/core/entityPermissions'
import { listUserCollections } from './collectionSchema'
import type { DataTableSettings } from '@/interfaces'
import { formatDisplayValue } from '../utils/recordDisplay'
import {
  fetchDataTableRuntime,
  type DataTableRuntime,
  type DataTableRuntimeColumn,
} from './dataTableRuntime'

export type ObjectRecordColumn = DataTableRuntimeColumn

export interface ObjectRecordList {
  collection: string
  label: string
  columns: ObjectRecordColumn[]
  records: Record<string, unknown>[]
  primaryKey: string
  totalCount: number
}

export interface ObjectRecordQueryOptions {
  limit?: number
  offset?: number
  archivedOnly?: boolean
}

export interface ReadableCollectionOption {
  label: string
  value: string
}

export async function listReadableCollections(): Promise<
  ReadableCollectionOption[]
> {
  await ensureEntityPermissions()
  const collections = await listUserCollections()
  const accessChecks = await Promise.all(
    collections.map(async (collection) => {
      if (!canReadEntity(collection.value)) return null
      try {
        await bridgeReadItems(collection.value, {
          fields: ['id'],
          limit: 1,
          offset: 0,
        })
        return collection
      } catch {
        return null
      }
    }),
  )

  return accessChecks.filter(
    (collection): collection is ReadableCollectionOption =>
      collection !== null,
  )
}

export async function fetchObjectRecords(
  collection: string,
  listFilter?: Record<string, unknown> | null,
  tableSettings?: DataTableSettings | null,
  options: ObjectRecordQueryOptions = {},
): Promise<ObjectRecordList> {
  const runtime = await fetchDataTableRuntime({
    collection,
    settings: tableSettings,
    listFilter,
    limit: options.limit ?? 100,
    offset: options.offset ?? 0,
    defaultColumnLimit: 12,
    excludeHiddenFields: true,
    archivedOnly: options.archivedOnly,
  })

  return toObjectRecordList(runtime)
}

export async function fetchObjectRecordsByIds(
  collection: string,
  recordIds: string[],
  totalCount: number,
  tableSettings?: DataTableSettings | null,
): Promise<ObjectRecordList> {
  const runtime = await fetchDataTableRuntime({
    collection,
    settings: tableSettings,
    recordIds,
    totalCountOverride: totalCount,
    defaultColumnLimit: 12,
    excludeHiddenFields: true,
  })

  return toObjectRecordList(runtime)
}

export function formatRecordValue(value: unknown): string {
  return formatDisplayValue(value, { arrayDisplay: 'count' })
}

function toObjectRecordList(runtime: DataTableRuntime): ObjectRecordList {
  return {
    collection: runtime.collection,
    label: runtime.label ?? runtime.collection,
    columns: runtime.columns,
    records: runtime.rows,
    primaryKey: runtime.primaryKey,
    totalCount: runtime.totalCount,
  }
}

export type { DataTableRuntime, DataTableRuntimeColumn }
