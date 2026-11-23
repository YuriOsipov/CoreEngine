import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'

/**
 * UI gate matching BFF owner RLS for update/delete.
 * When current user id is unknown (cache cold), allow write chrome to avoid flicker.
 */
export function canWriteOwnedRecord(
  record: Record<string, unknown>,
  currentUserId: string | null | undefined,
): boolean {
  const me = String(currentUserId ?? '').trim()
  if (!me) return true
  const owner =
    extractRelationFieldId(record.owner_id) ??
    extractRelationFieldId(record.user_created)
  if (owner === null) return true
  return String(owner) === me
}
