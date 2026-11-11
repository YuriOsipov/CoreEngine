/**
 * Shared list-query policy for REST / GraphQL / SOQL.
 * - Soft-deleted rows require export (admins bypass via assertMeEntityPermission).
 * - Read limits are capped; larger / unlimited pulls require export.
 */
import type { MeUser } from '../adapters/usersAdapter.js'
import { assertMeEntityPermission } from '../services/rolePermissions.js'

export const DEFAULT_LIST_LIMIT = 100
/** Max rows for ordinary read without export permission. */
export const MAX_READ_LIMIT = 500
/** Hard ceiling even with export (DoS guard). */
export const MAX_EXPORT_LIMIT = 10_000

export async function assertIncludeDeletedAllowed(
  me: MeUser,
  collection: string,
  includeDeleted: boolean,
): Promise<void> {
  if (!includeDeleted) return
  await assertMeEntityPermission(me, collection, 'export')
}

/**
 * Resolve a safe limit. Requests above MAX_READ_LIMIT or unlimited (< 0)
 * require export permission; always capped at MAX_EXPORT_LIMIT.
 */
export async function resolveAuthorizedListLimit(
  me: MeUser,
  collection: string,
  requested: number | null | undefined,
  fallback: number = DEFAULT_LIST_LIMIT,
): Promise<number> {
  const raw =
    requested == null || !Number.isFinite(Number(requested))
      ? fallback
      : Math.trunc(Number(requested))

  if (raw < 0 || raw > MAX_READ_LIMIT) {
    await assertMeEntityPermission(me, collection, 'export')
    if (raw < 0) return MAX_EXPORT_LIMIT
    return Math.min(raw, MAX_EXPORT_LIMIT)
  }

  return Math.min(Math.max(raw, 0), MAX_READ_LIMIT)
}
