import type { MeUser } from '../usersAdapter.js'
import { resolveFieldAccess } from '../../services/fieldSecurity.js'
import { assertMeEntityPermission } from '../../services/rolePermissions.js'

/**
 * Label fields safe to ILIKE for M2O "Use in search" given the caller.
 * Returns null when the related entity must not participate in search at all
 * (no entity read, or every template/fallback field is unreadable).
 */
export async function filterM2OSearchLabelFields(
  me: MeUser | null | undefined,
  relatedEntityApiName: string,
  labelFields: string[],
): Promise<string[] | null> {
  if (!me) return labelFields.length ? labelFields : null
  try {
    await assertMeEntityPermission(me, relatedEntityApiName, 'read')
  } catch {
    return null
  }
  const access = await resolveFieldAccess(me, relatedEntityApiName)
  if (!access?.unreadable.size) return labelFields.length ? labelFields : null
  const kept = labelFields.filter((field) => !access.unreadable.has(field))
  return kept.length ? kept : null
}
