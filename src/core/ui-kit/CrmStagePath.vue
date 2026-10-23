<script lang="ts">
export default {
  name: 'CrmStagePath',
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MenuItem } from 'openvue/menuitem'
import { useTranslation } from '@/core/translation'

export type CrmStagePathStep = {
  label: string
  value: string | number | boolean
}

export type CrmStagePathChange = {
  updates: Record<string, unknown>
}

const props = withDefaults(
  defineProps<{
    /** Open-stage picklist api name. */
    field: string
    steps: CrmStagePathStep[]
    modelValue?: unknown
    /** Optional terminal/outcome picklist api name. */
    terminalField?: string | null
    terminalSteps?: CrmStagePathStep[]
    terminalValue?: unknown
    /** Terminal values styled as success; others are failure. */
    successTerminalValues?: string[]
    disabled?: boolean
    saving?: boolean
  }>(),
  {
    terminalField: null,
    terminalSteps: () => [],
    successTerminalValues: () => [],
    disabled: false,
    saving: false,
  },
)

const emit = defineEmits<{
  change: [payload: CrmStagePathChange]
}>()

const { t } = useTranslation()
const terminalMenu = ref<{ toggle: (event: Event) => void } | null>(null)

const hasTerminalField = computed(
  () => Boolean(props.terminalField && props.terminalSteps.length > 0),
)

const currentIndex = computed(() => {
  const value = props.modelValue
  if (value === undefined || value === null || value === '') return -1
  return props.steps.findIndex((step) => String(step.value) === String(value))
})

const isClosed = computed(() => {
  if (!hasTerminalField.value) return false
  return props.terminalValue !== undefined
    && props.terminalValue !== null
    && props.terminalValue !== ''
})

const closedTerminalStep = computed((): CrmStagePathStep | null => {
  if (!isClosed.value) return null
  return (
    props.terminalSteps.find((step) => String(step.value) === String(props.terminalValue))
    ?? {
      label: String(props.terminalValue),
      value: props.terminalValue as string | number | boolean,
    }
  )
})

const closedTerminalKind = computed((): 'success' | 'failure' => {
  const value = String(props.terminalValue ?? '')
  return props.successTerminalValues.some((item) => String(item) === value)
    ? 'success'
    : 'failure'
})

const canMarkCompleteAdvance = computed(() => {
  if (props.disabled || props.saving || props.steps.length === 0 || isClosed.value) {
    return false
  }
  const idx = currentIndex.value
  if (idx < 0) return true
  return idx < props.steps.length - 1
})

/** Closed Status is available from any open stage when a terminal field is configured. */
const canOpenTerminalMenu = computed(() => {
  if (props.disabled || props.saving || !hasTerminalField.value) return false
  return true
})

const showMarkComplete = computed(
  () => !isClosed.value && (!hasTerminalField.value || canMarkCompleteAdvance.value),
)

const showClosedStatusButton = computed(
  () => hasTerminalField.value && !isClosed.value,
)

const showChangeOutcomeButton = computed(
  () => hasTerminalField.value && isClosed.value,
)

const terminalMenuItems = computed((): MenuItem[] =>
  props.terminalSteps.map((step) => ({
    label: step.label,
    command: () => selectTerminal(step),
  })),
)

function stepState(index: number): 'completed' | 'current' | 'upcoming' {
  if (isClosed.value) {
    return index <= Math.max(currentIndex.value, 0) ? 'completed' : 'upcoming'
  }
  const current = currentIndex.value
  if (current < 0) return index === 0 ? 'current' : 'upcoming'
  if (index < current) return 'completed'
  if (index === current) return 'current'
  return 'upcoming'
}

function emitUpdates(updates: Record<string, unknown>): void {
  if (Object.keys(updates).length === 0) return
  emit('change', { updates })
}

function selectStep(step: CrmStagePathStep): void {
  if (props.disabled || props.saving) return
  const updates: Record<string, unknown> = {}
  if (String(props.modelValue) !== String(step.value)) {
    updates[props.field] = step.value
  }
  if (hasTerminalField.value && props.terminalField && isClosed.value) {
    updates[props.terminalField] = null
  }
  if (Object.keys(updates).length === 0) return
  emitUpdates(updates)
}

function selectTerminal(step: CrmStagePathStep): void {
  if (props.disabled || props.saving || !props.terminalField) return
  if (String(props.terminalValue) === String(step.value)) return
  emitUpdates({ [props.terminalField]: step.value })
}

function markComplete(): void {
  if (!canMarkCompleteAdvance.value) return
  const idx = currentIndex.value
  const next = idx < 0 ? props.steps[0] : props.steps[idx + 1]
  if (!next) return
  // Advance open stage only — terminal outcomes use Closed Status.
  emitUpdates({ [props.field]: next.value })
}

function toggleTerminalMenu(event: Event): void {
  if (!canOpenTerminalMenu.value) return
  terminalMenu.value?.toggle(event)
}
</script>

<template>
  <div class="crm-stage-path">
    <div
      class="crm-stage-path__track"
      role="list"
      :aria-label="t('recordPage.path.ariaLabel', 'Stage path')"
    >
      <button
        v-for="(step, index) in steps"
        :key="String(step.value)"
        type="button"
        role="listitem"
        class="crm-stage-path__step"
        :class="`crm-stage-path__step--${stepState(index)}`"
        :disabled="disabled || saving"
        :aria-current="!isClosed && stepState(index) === 'current' ? 'step' : undefined"
        :aria-label="step.label"
        v-tooltip.top="step.label"
        @click="selectStep(step)"
      >
        <span
          v-if="stepState(index) === 'completed'"
          class="crm-stage-path__check pi pi-check"
          aria-hidden="true"
        />
        <span class="crm-stage-path__label">{{ step.label }}</span>
      </button>

      <button
        v-if="closedTerminalStep"
        type="button"
        role="listitem"
        class="crm-stage-path__step"
        :class="
          closedTerminalKind === 'success'
            ? 'crm-stage-path__step--terminal-success'
            : 'crm-stage-path__step--terminal-failure'
        "
        :disabled="disabled || saving"
        aria-current="step"
        :aria-label="closedTerminalStep.label"
        v-tooltip.top="closedTerminalStep.label"
        @click="toggleTerminalMenu"
      >
        <span
          class="crm-stage-path__check"
          :class="closedTerminalKind === 'success' ? 'pi pi-check' : 'pi pi-times'"
          aria-hidden="true"
        />
        <span class="crm-stage-path__label">{{ closedTerminalStep.label }}</span>
      </button>
    </div>

    <div
      v-if="showMarkComplete || showClosedStatusButton || showChangeOutcomeButton"
      class="crm-stage-path__actions shrink-0"
    >
      <Button
        v-if="showMarkComplete"
        class="crm-stage-path__complete"
        :label="t('recordPage.path.markComplete', 'Mark Stage as Complete')"
        size="small"
        :disabled="!canMarkCompleteAdvance"
        :loading="saving"
        @click="markComplete"
      />
      <Button
        v-if="showClosedStatusButton"
        class="crm-stage-path__complete"
        :label="t('recordPage.path.markClosed', 'Select Closed Status')"
        size="small"
        :severity="showMarkComplete ? 'secondary' : undefined"
        :outlined="showMarkComplete"
        :disabled="!canOpenTerminalMenu"
        :loading="saving"
        icon="pi pi-chevron-down"
        icon-pos="right"
        @click="toggleTerminalMenu"
      />
      <Button
        v-if="showChangeOutcomeButton"
        class="crm-stage-path__complete"
        :label="t('recordPage.path.changeOutcome', 'Change Outcome')"
        size="small"
        severity="secondary"
        outlined
        :disabled="!canOpenTerminalMenu"
        :loading="saving"
        icon="pi pi-chevron-down"
        icon-pos="right"
        @click="toggleTerminalMenu"
      />
      <Menu
        ref="terminalMenu"
        :model="terminalMenuItems"
        popup
      />
    </div>
  </div>
</template>

<style scoped>
.crm-stage-path {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.crm-stage-path__track {
  display: flex;
  flex: 1 1 12rem;
  width: 100%;
  min-width: 0;
}

.crm-stage-path__step {
  position: relative;
  display: inline-flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  width: 0;
  min-width: 0;
  margin: 0;
  padding: 0.55rem 1.25rem 0.55rem 1.1rem;
  border: 0;
  background: var(--p-surface-200);
  color: var(--p-text-muted-color);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  clip-path: polygon(
    0 0,
    calc(100% - 0.7rem) 0,
    100% 50%,
    calc(100% - 0.7rem) 100%,
    0 100%,
    0.7rem 50%
  );
}

.crm-stage-path__step:first-child {
  padding-left: 0.9rem;
  clip-path: polygon(
    0 0,
    calc(100% - 0.7rem) 0,
    100% 50%,
    calc(100% - 0.7rem) 100%,
    0 100%
  );
  border-radius: 0.35rem 0 0 0.35rem;
}

.crm-stage-path__step:last-child {
  padding-right: 0.9rem;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 0.7rem 50%);
  border-radius: 0 0.35rem 0.35rem 0;
}

.crm-stage-path__step:first-child:last-child {
  clip-path: none;
  border-radius: 0.35rem;
  padding-inline: 0.9rem;
}

.crm-stage-path__step + .crm-stage-path__step {
  margin-left: -0.35rem;
}

.crm-stage-path__step:disabled {
  cursor: default;
  opacity: 0.85;
}

.crm-stage-path__step--completed {
  background: var(--p-green-500, #22c55e);
  color: #fff;
}

.crm-stage-path__step--current {
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color, #fff);
}

.crm-stage-path__step--upcoming {
  background: var(--p-surface-100);
  color: var(--p-primary-color);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--p-primary-color) 35%, transparent);
}

.crm-stage-path__step--terminal-success {
  background: var(--p-green-600, #16a34a);
  color: #fff;
}

.crm-stage-path__step--terminal-failure {
  background: var(--p-red-500, #ef4444);
  color: #fff;
}

.crm-stage-path__label {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crm-stage-path__check {
  flex-shrink: 0;
  font-size: 0.7rem;
}

.crm-stage-path__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.crm-stage-path__complete {
  white-space: nowrap;
}
</style>
