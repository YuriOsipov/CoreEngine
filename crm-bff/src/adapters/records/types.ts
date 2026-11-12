import type { MeUser } from '../usersAdapter.js'

export type LiveRecordsBackendId = 'SUPABASE' | 'HASURA' | 'DIRECTUS'

/**
 * Verified caller for facade ACL / field security.
 * Use `SYSTEM_RECORD_ACCESS` for trusted server jobs (rollups, audit capture).
 * Omitting access at a facade boundary is a type error — never rely on
 * undefined / bare `{ me: null }` meaning "system".
 */
export type RecordAccess = {
  me: MeUser | null
  /** Only `SYSTEM_RECORD_ACCESS` sets this. Bare `{ me: null }` is not system. */
  readonly system?: true
}

/** Explicit system / trusted-server caller — bypasses user field ACL intentionally. */
export const SYSTEM_RECORD_ACCESS: RecordAccess = Object.freeze({
  me: null,
  system: true as const,
})

/** True only for the frozen system sentinel — not for `{ me: null }` typos. */
export function isSystemRecordAccess(access: RecordAccess): boolean {
  return access.system === true
}

export interface RecordsListParams {
  filter?: Record<string, unknown> | null
  fields?: string[] | null
  sort?: string[] | null
  limit?: number
  offset?: number
  search?: string | null
  includeDeleted?: boolean
  /**
   * Required on facade list/read helpers (`findManyRecords`, …).
   * Optional only inside store backends; missing means system for store search.
   */
  access?: RecordAccess | null
  /** Columns the caller cannot read — excluded from list `search` matching. */
  searchExcludeFields?: string[] | null
}

/** Facade list params — `access` is mandatory so forgetting it is a type error. */
export type FacadeListParams = Omit<RecordsListParams, 'access'> & {
  access: RecordAccess
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
