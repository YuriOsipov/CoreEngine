<script lang="ts">
export default { name: 'ChangeOwnerDialog' }
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import { readUsersBridge } from '@/core/graphql/usersApi'
import { updateObjectRecord } from '@/modules/entities/services/recordDetails'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'

const props = defineProps<{
  visible: boolean
  collection: string
  recordId: string
  currentOwnerId?: string | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: [record: Record<string, unknown>]
}>()

const { t } = useTranslation()
const toast = useToast()

type UserOption = {
  id: string
  label: string
}

const selected = ref<UserOption | null>(null)
const suggestions = ref<UserOption[]>([])
const saving = ref(false)
const searching = ref(false)

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

function formatUserLabel(row: Record<string, unknown>): string {
  const first = String(row.first_name ?? '').trim()
  const last = String(row.last_name ?? '').trim()
  const email = String(row.email ?? '').trim()
  const name = [first, last].filter(Boolean).join(' ')
  if (name && email) return `${name} (${email})`
  return name || email || String(row.id ?? '')
}

async function searchUsers(event: { query: string }): Promise<void> {
  searching.value = true
  try {
    const rows = await readUsersBridge({
      search: event.query?.trim() || null,
      fields: ['id', 'first_name', 'last_name', 'email', 'is_active'],
      limit: 25,
      sort: ['first_name', 'last_name'],
    })
    suggestions.value = rows
      .filter((row) => row.is_active !== false)
      .map((row) => {
        const id = extractRelationFieldId(row.id) ?? String(row.id ?? '')
        return { id, label: formatUserLabel(row) }
      })
      .filter((row) => row.id)
  } catch (error) {
    suggestions.value = []
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('recordDetails.changeOwnerSearchFailed', 'Could not search users.'),
      life: 4000,
    })
  } finally {
    searching.value = false
  }
}

watch(
  () => props.visible,
  (open) => {
    if (!open) {
      selected.value = null
      suggestions.value = []
      return
    }
    void searchUsers({ query: '' })
  },
)

async function confirmChange(): Promise<void> {
  const ownerId = selected.value?.id?.trim()
  if (!ownerId || !props.collection || !props.recordId) return
  if (props.currentOwnerId && ownerId === String(props.currentOwnerId)) {
    dialogVisible.value = false
    return
  }
  saving.value = true
  try {
    const updated = await updateObjectRecord(props.collection, props.recordId, {
      owner_id: ownerId,
    })
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('recordDetails.changeOwnerSuccess', 'Owner updated.'),
      life: 3000,
    })
    emit('saved', updated)
    dialogVisible.value = false
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('recordDetails.changeOwnerFailed', 'Could not change owner.'),
      life: 5000,
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :header="t('recordDetails.changeOwner', 'Change Owner')"
    :style="{ width: '28rem' }"
    :closable="!saving"
  >
    <div class="flex flex-column gap-3">
      <label class="text-sm" for="change-owner-user">
        {{ t('recordDetails.changeOwnerPickUser', 'New owner') }}
      </label>
      <AutoComplete
        id="change-owner-user"
        v-model="selected"
        :suggestions="suggestions"
        option-label="label"
        dropdown
        force-selection
        :loading="searching"
        :placeholder="t('recordDetails.changeOwnerSearch', 'Search users…')"
        class="w-full"
        input-class="w-full"
        @complete="searchUsers"
      />
    </div>
    <template #footer>
      <Button
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        :disabled="saving"
        @click="dialogVisible = false"
      />
      <Button
        :label="t('recordDetails.changeOwnerConfirm', 'Change Owner')"
        :loading="saving"
        :disabled="!selected?.id || saving"
        @click="confirmChange"
      />
    </template>
  </Dialog>
</template>
