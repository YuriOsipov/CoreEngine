export type LiveRecordsBackendId = 'SUPABASE' | 'HASURA' | 'DIRECTUS'

export interface RecordsListParams {
  filter?: Record<string, unknown> | null
  fields?: string[] | null
  sort?: string[] | null
  limit?: number
  offset?: number
  search?: string | null
  includeDeleted?: boolean
}

export interface RecordsListResult {
  nodes: Record<string, unknown>[]
  totalCount: number
}

export interface RecordsAggregateOptions {
  aggregate: Record<string, unknown>
  groupBy?: string[] | null
  filter?: Record<string, unknown> | null
  limit?: number
}

export interface RecordsStore {
  readonly id: LiveRecordsBackendId
  findMany(entity: string, params?: RecordsListParams): Promise<RecordsListResult>
  findOne(
    entity: string,
    id: string,
    fields?: string[] | null,
  ): Promise<Record<string, unknown>>
  create(
    entity: string,
    data: Record<string, unknown>,
    fields?: string[] | null,
  ): Promise<Record<string, unknown>>
  update(
    entity: string,
    id: string,
    data: Record<string, unknown>,
    fields?: string[] | null,
  ): Promise<Record<string, unknown>>
  softDelete(entity: string, id: string): Promise<Record<string, unknown>>
  restore(entity: string, id: string): Promise<Record<string, unknown>>
  hardDelete(entity: string, id: string): Promise<boolean>
  aggregate(
    entity: string,
    options: RecordsAggregateOptions,
  ): Promise<Record<string, unknown>[]>
  clearCache?(): void
}
