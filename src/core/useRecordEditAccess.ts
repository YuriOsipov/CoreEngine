import {
  computed,
  onMounted,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'
import { currentUser } from '@/core/currentUser'
import { useEntityPermissions } from '@/core/entityPermissions'
import { getRolePreviewOverride } from '@/core/rolePreview'
import { fetchAppRolesAdmin } from '@/core/graphql/userAdminApi'
import { isUsersAssetCollection } from '@/core/usersField'

/**
 * Record Edit access: normal matrix canUpdate, except `users` where
 * real admins may edit any record and everyone may edit their own.
 * Admin "View as role" must follow the previewed role (no admin bypass).
 */
export function useRecordEditAccess(
  collection: MaybeRefOrGetter<string | null | undefined>,
  recordId: MaybeRefOrGetter<string | null | undefined>,
): {
  canEdit: Ref<boolean>
  ready: Ref<boolean>
  refresh: () => Promise<void>
} {
  const {
    canUpdate,
    ready: permissionsReady,
    refresh: refreshPermissions,
  } = useEntityPermissions(collection)

  const selfOrAdminUsersEdit = ref(false)
  const identityReady = ref(false)

  async function previewRoleIsAdmin(roleRef: string): Promise<boolean> {
    const raw = String(roleRef || '').trim()
    if (!raw) return false
    try {
      const roles = await fetchAppRolesAdmin()
      const matched = roles.find(
        (role) =>
          String(role.id) === raw ||
          (role.backendRoleId != null && String(role.backendRoleId) === raw),
      )
      return Boolean(matched?.isAdmin)
    } catch {
      return false
    }
  }

  async function refreshUsersSelfEdit(): Promise<void> {
    const col = String(toValue(collection) || '').trim()
    if (!isUsersAssetCollection(col)) {
      selfOrAdminUsersEdit.value = false
      identityReady.value = true
      return
    }
    try {
      const user = await currentUser()
      const meId = user.id != null ? String(user.id).trim() : ''
      const target = String(toValue(recordId) ?? '').trim()
      const isSelf = Boolean(meId && target && meId === target)

      if (!user.isAdmin) {
        selfOrAdminUsersEdit.value = isSelf
        return
      }

      // Real admin session (not previewing) → edit any user.
      const preview = getRolePreviewOverride()
      if (preview === undefined) {
        selfOrAdminUsersEdit.value = true
        return
      }

      // Previewing "Default (all roles)" → no admin bypass; self only.
      if (preview === null) {
        selfOrAdminUsersEdit.value = isSelf
        return
      }

      // Previewing a concrete role → admin bypass only if that role is admin.
      if (await previewRoleIsAdmin(preview)) {
        selfOrAdminUsersEdit.value = true
        return
      }
      selfOrAdminUsersEdit.value = isSelf
    } catch {
      selfOrAdminUsersEdit.value = false
    } finally {
      identityReady.value = true
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshPermissions(), refreshUsersSelfEdit()])
  }

  onMounted(() => {
    void refresh()
  })
  void refresh()

  watch(
    [() => toValue(collection), () => toValue(recordId)],
    () => {
      void refreshUsersSelfEdit()
    },
  )

  const ready = computed(
    () => permissionsReady.value && identityReady.value,
  )

  const canEdit = computed(() => {
    const col = String(toValue(collection) || '').trim()
    if (isUsersAssetCollection(col)) return selfOrAdminUsersEdit.value
    return canUpdate.value
  })

  return { canEdit, ready, refresh }
}
