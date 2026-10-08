import { fileAssetUrl } from '@/core/useFiles'

export interface UserAuditSnapshot {
  id?: string | number | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  avatar?: string | { id?: string | null } | null
}

export function formatAuditUserName(
  user: UserAuditSnapshot | string | null | undefined,
): string {
  if (!user) return ''
  if (typeof user === 'string') {
    const trimmed = user.trim()
    // Bare UUID FKs are not display names — expansion should replace these.
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        trimmed,
      )
    ) {
      return ''
    }
    return trimmed
  }

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  if (name) return name
  if (user.email?.trim()) return user.email.trim()
  if (user.id !== undefined && user.id !== null) {
    const id = String(user.id)
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ) {
      return ''
    }
    return id
  }
  return ''
}

export function resolveUserAvatarId(
  user: UserAuditSnapshot | string | null | undefined,
): string | null {
  if (!user || typeof user === 'string') return null

  const avatar = user.avatar
  if (!avatar) return null
  if (typeof avatar === 'string') return avatar.trim() || null
  if (typeof avatar === 'object' && avatar.id) return String(avatar.id)
  return null
}

export function resolveUserAvatarUrl(
  user: UserAuditSnapshot | string | null | undefined,
): string | null {
  const avatarId = resolveUserAvatarId(user)
  return avatarId ? fileAssetUrl(avatarId) : null
}

export function userInitials(
  user: UserAuditSnapshot | string | null | undefined,
): string {
  const name = formatAuditUserName(user)
  if (!name) return '?'

  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase()
}
