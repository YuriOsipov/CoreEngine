<script lang="ts">
export default {
  name: 'RolePreviewSelector',
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { currentUser } from '@/core/currentUser'
import { clearEntityPermissionsCache } from '@/core/entityPermissions'
import {
  ACTUAL_ROLE_SELECT_VALUE,
  clearRolePreviewOverride,
  getRolePreviewOverride,
  isRolePreviewActive,
  setRolePreviewDisplayLabel,
  setRolePreviewOverride,
} from '@/core/rolePreview'
import {
  DEFAULT_ROLE_SELECT_VALUE,
  loadAppRoles,
  roleIdToSelectValue,
} from '@/core/settingRoleUtils'
import { useTranslation } from '@/core/translation'

const emit = defineEmits<{
  'preview-active': [active: boolean]
  'preview-label': [label: string]
}>()

const { t } = useTranslation()
const visible = ref(false)
const loading = ref(true)
const roleOptions = ref<Array<{ label: string; value: string }>>([])
const selectedValue = ref(ACTUAL_ROLE_SELECT_VALUE)

const defaultRoleLabel = computed(() =>
  t('layoutRole.defaultRole', 'Default (all roles)'),
)

const previewLabel = computed(() => {
  if (!isRolePreviewActive()) return ''

  const override = getRolePreviewOverride()
  if (override === null) {
    return defaultRoleLabel.value
  }

  const matched = roleOptions.value.find((option) => option.value === override)
  return matched?.label ?? override
})

onMounted(async () => {
  loading.value = true
  try {
    const user = await currentUser()
    if (!user.isAdmin) {
      // Drop leftover preview from a previous admin session in this tab.
      clearRolePreviewOverride()
      visible.value = false
      emit('preview-active', false)
      emit('preview-label', '')
      return
    }

    visible.value = true
    let roles: Awaited<ReturnType<typeof loadAppRoles>> = []
    try {
      roles = await loadAppRoles()
    } catch {
      roles = []
    }
    roleOptions.value = [
      {
        label: t('app.rolePreviewActual', 'My role ({role})', {
          role: user.roleName ?? t('app.rolePreviewUnknownRole', 'Unknown'),
        }),
        value: ACTUAL_ROLE_SELECT_VALUE,
      },
      ...roles.map((role) => ({
        label: role.name,
        value: role.id,
      })),
      {
        label: defaultRoleLabel.value,
        value: DEFAULT_ROLE_SELECT_VALUE,
      },
    ]

    const override = getRolePreviewOverride()
    selectedValue.value =
      override === undefined
        ? ACTUAL_ROLE_SELECT_VALUE
        : roleIdToSelectValue(override)
    emitPreviewState()
  } catch {
    visible.value = false
    emitPreviewState()
  } finally {
    loading.value = false
  }
})

function emitPreviewState(): void {
  const active = isRolePreviewActive()
  const label = active ? (previewLabel.value || '') : ''
  setRolePreviewDisplayLabel(label)
  emit('preview-active', active)
  emit('preview-label', label)
}

function handleRolePreviewChange(value: string): void {
  if (value === selectedValue.value) return

  if (value === ACTUAL_ROLE_SELECT_VALUE) {
    clearRolePreviewOverride()
  } else if (value === DEFAULT_ROLE_SELECT_VALUE) {
    setRolePreviewOverride(null)
  } else {
    setRolePreviewOverride(value)
  }

  // Drop any in-memory admin-full matrix before reload (HMR / soft paths).
  clearEntityPermissionsCache()
  window.location.reload()
}
</script>

<template>
  <div
    v-if="visible && !loading"
    class="flex items-center gap-2"
  >
    <label class="text-muted-color text-[0.8rem] font-semibold whitespace-nowrap" for="crm-role-preview">
      {{ t('app.rolePreview', 'View as role') }}
    </label>
    <Select
      id="crm-role-preview"
      :model-value="selectedValue"
      :options="roleOptions"
      option-label="label"
      option-value="value"
      size="small"
      @update:model-value="handleRolePreviewChange"
    />
  </div>
</template>
