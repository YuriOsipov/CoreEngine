<script lang="ts">
export default {
  name: 'RoleScopedLayoutSelector',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { useConfirm } from 'openvue/useconfirm'
import { useTranslation } from '@/core/translation'
import { layoutLabelForRole, buildRoleSelectOptions, roleIdToSelectValue, selectValueToRoleId, canDeleteRoleScopedLayout } from '@/core/settingRoleUtils'
import type { AppRoleOption, RoleScopedLayoutMode, SavedRoleScopedLayout } from '@/interfaces'

const props = withDefaults(
  defineProps<{
    mode?: RoleScopedLayoutMode
    layoutLabel: string
    variantLabel?: string
    layouts?: SavedRoleScopedLayout[]
    selectedLayoutId?: string | null
    layoutName?: string
    roleId: string | null
    roleOptions: AppRoleOption[]
    loading?: boolean
    saving?: boolean
    deleting?: boolean
    setupMode?: boolean
    /** When false, hides the role selector (Block Layouts are role-free). */
    showRole?: boolean
    /** Allow deleting the selected layout even when role is default/null. */
    allowDeleteDefault?: boolean
    /** Optional (i) tooltip next to Layout name. */
    hint?: string
  }>(),
  {
    mode: 'single',
    variantLabel: '',
    layouts: () => [],
    selectedLayoutId: null,
    layoutName: '',
    loading: false,
    saving: false,
    deleting: false,
    setupMode: false,
    showRole: true,
    allowDeleteDefault: false,
    hint: '',
  },
)

const emit = defineEmits<{
  'update:layoutName': [value: string]
  'update:roleId': [value: string | null]
  'layout-selected': [layoutId: string]
  'new-layout': []
  'save-layout': []
  'delete-layout': []
}>()

function hintTooltip(value: string) {
  return { value, class: 'layout-selector-hint-tooltip' }
}

const confirm = useConfirm()
const { t } = useTranslation()

const defaultRoleLabel = computed(() =>
  t('layoutRole.defaultRole', 'Default (all roles)'),
)

const layoutOptions = computed(() =>
  props.layouts.map((layout) => ({
    label: layoutLabelForRole(layout, defaultRoleLabel.value),
    value: layout.id,
  })),
)

const roleSelectOptions = computed(() =>
  buildRoleSelectOptions(props.roleOptions, defaultRoleLabel.value),
)

const canDeleteSelectedLayout = computed(() => {
  if (props.mode !== 'single') return false
  const selected = props.layouts.find((layout) => layout.id === props.selectedLayoutId)
  if (!selected) return false
  if (props.allowDeleteDefault) {
    return canDeleteRoleScopedLayout(selected, props.layouts)
  }
  return selected.roleId !== null
})

function handleLayoutSelected(layoutId: string): void {
  if (layoutId && layoutId !== props.selectedLayoutId) {
    emit('layout-selected', layoutId)
  }
}

function confirmDeleteLayout(): void {
  if (!canDeleteSelectedLayout.value) return

  confirm.require({
    message: t('layoutRole.deleteConfirm', 'Delete this layout?'),
    header: t('layoutRole.deleteLayout', 'Delete layout'),
    icon: 'pi pi-exclamation-triangle',
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: {
      label: t('layoutRole.deleteLayout', 'Delete layout'),
      severity: 'danger',
    },
    accept: () => emit('delete-layout'),
  })
}
</script>

<template>
  <div class="role-scoped-layout-selector flex flex-col gap-2 mt-0">
    <div class="flex items-end flex-nowrap justify-start gap-2.5">
      <div
        v-if="mode === 'single' && !setupMode"
        class="flex flex-col gap-[0.3rem]"
      >
        <label class="text-surface-600 text-[0.75rem] font-medium leading-tight">
          {{ layoutLabel }}
        </label>
        <Select
          :model-value="selectedLayoutId ?? ''"
          :options="layoutOptions"
          option-label="label"
          option-value="value"
          class="min-w-[240px]"
          :disabled="loading || layoutOptions.length === 0"
          @update:model-value="handleLayoutSelected(String($event ?? ''))"
        />
      </div>

      <div
        v-if="mode === 'single'"
        class="layout-name flex flex-col gap-[0.3rem]"
      >
        <label class="layout-name__label">
          {{ variantLabel || t('layoutRole.layoutName', 'Layout name') }}
          <button
            v-if="hint"
            type="button"
            class="layout-selector-hint"
            :aria-label="t('common.hint', 'Hint')"
            v-tooltip.bottom="hintTooltip(hint)"
          />
        </label>
        <InputText
          :model-value="layoutName"
          class="layout-name__input"
          :disabled="loading"
          @update:model-value="emit('update:layoutName', String($event ?? ''))"
        />
      </div>

      <div
        v-if="showRole"
        class="flex flex-col gap-[0.3rem]"
      >
        <label class="text-surface-600 text-[0.75rem] font-medium leading-tight">
          {{ t('layoutRole.role', 'Role') }}
        </label>
        <Select
          :model-value="roleIdToSelectValue(roleId)"
          :options="roleSelectOptions"
          option-label="label"
          option-value="value"
          class="min-w-[10rem] max-w-[14rem]"
          :disabled="loading"
          @update:model-value="emit('update:roleId', selectValueToRoleId($event))"
        />
      </div>

      <div
        v-if="mode === 'single'"
        class="ml-auto flex flex-nowrap items-center gap-1.5 pb-[1px] shrink-0"
      >
        <Button
          v-if="!setupMode"
          :label="t('layoutRole.newLayout', 'New layout')"
          size="small"
          text
          :disabled="loading || saving"
          @click="emit('new-layout')"
        />
        <Button
          :label="t('layoutRole.saveLayout', 'Save layout')"
          icon="pi pi-save"
          size="small"
          :loading="saving"
          :disabled="loading || saving || !layoutName?.trim()"
          @click="emit('save-layout')"
        />
        <Button
          :label="t('layoutRole.deleteLayout', 'Delete layout')"
          icon="pi pi-trash"
          size="small"
          severity="danger"
          outlined
          :disabled="!canDeleteSelectedLayout || loading || saving || deleting"
          :loading="deleting"
          @click="confirmDeleteLayout"
        />
      </div>
    </div>

    <slot />
  </div>
</template>

<style scoped>
.role-scoped-layout-selector {
  width: 100%;
  box-sizing: border-box;
  background: #edf3f4;
  border-radius: 8px;
  padding: 0.45rem 0.5rem;
}

.layout-name__label {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.25;
  color: var(--p-surface-600, rgba(55, 53, 47, 0.55));
}

.layout-selector-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  height: 0.95rem;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(55, 53, 47, 0.4);
  border-radius: 50%;
  background: transparent;
  color: rgba(55, 53, 47, 0.55);
  font-size: 0.58rem;
  font-style: italic;
  font-weight: 600;
  line-height: 1;
  cursor: help;
}

.layout-selector-hint:focus-visible {
  outline: 2px solid rgba(55, 53, 47, 0.35);
  outline-offset: 2px;
}

.layout-selector-hint::before {
  content: 'i';
}

.layout-name__input,
.layout-name :deep(.p-inputtext) {
  min-width: 8.5rem;
  max-width: 14rem;
}
</style>

<style>
.layout-selector-hint-tooltip,
.layout-selector-hint-tooltip .p-tooltip-text {
  max-width: 18rem;
  font-size: 0.75rem;
  line-height: 1.35;
}
</style>
