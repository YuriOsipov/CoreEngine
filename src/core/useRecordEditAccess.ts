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
import { isUsersAssetCollection } from '@/core/usersField'

/**
 * Record Edit access: normal matrix canUpdate, except `users` where
 * admins may edit any record and everyone may edit their own.
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

  async function refreshUsersSelfEdit(): Promise<void> {
    const col = String(toValue(collection) || '').trim()
    if (!isUsersAssetCollection(col)) {
      selfOrAdminUsersEdit.value = false
      identityReady.value = true
      return
    }
    try {
      const user = await currentUser()
      if (user.isAdmin) {
        selfOrAdminUsersEdit.value = true
        return
      }
      const meId = user.id != null ? String(user.id).trim() : ''
      const target = String(toValue(recordId) ?? '').trim()
      selfOrAdminUsersEdit.value = Boolean(meId && target && meId === target)
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
