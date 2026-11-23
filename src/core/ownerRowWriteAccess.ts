import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'

export type OwnerWriteAccessOptions = {
  /** Role Modify all / admin bypass for owner RLS (matches BFF). */
  bypassOwnerFilter?: boolean
}

/**
 * UI gate matching BFF owner RLS for update/delete.
 * When current user id is unknown (cache cold), allow write chrome to avoid flicker.
 * Pass `bypassOwnerFilter` when the role has Modify all (or admin full access).
 */
export function canWriteOwnedRecord(
  record: Record<string, unknown>,
  currentUserId: string | null | undefined,
  options?: OwnerWriteAccessOptions,
): boolean {
  if (options?.bypassOwnerFilter) return true
  const me = String(currentUserId ?? '').trim()
  if (!me) return true
  const owner =
    extractRelationFieldId(record.owner_id) ??
    extractRelationFieldId(record.user_created)
  if (owner === null) return true
  return String(owner) === me
}

/** True when the caller may open Change Owner for this row. */
export function canChangeRecordOwner(
  record: Record<string, unknown>,
  currentUserId: string | null | undefined,
  options?: OwnerWriteAccessOptions & { canUpdate?: boolean },
): boolean {
  if (options?.canUpdate === false) return false
  if (options?.bypassOwnerFilter) return true
  return canWriteOwnedRecord(record, currentUserId)
}
