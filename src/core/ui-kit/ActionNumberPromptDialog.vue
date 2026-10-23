<script lang="ts">
export default {
  name: 'ActionNumberPromptDialog',
}
</script>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    visible: boolean
    header?: string
    label?: string
    confirmLabel?: string
    initialValue?: number | null
  }>(),
  {
    header: '',
    label: '',
    confirmLabel: '',
    initialValue: null,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [value: number]
}>()

const { t } = useTranslation()
const value = ref<number | null>(null)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      value.value =
        props.initialValue != null && Number.isFinite(props.initialValue)
          ? props.initialValue
          : null
    }
  },
)

const canConfirm = () => value.value != null && Number.isFinite(value.value)

function confirm(): void {
  if (!canConfirm() || value.value == null) return
  emit('confirm', value.value)
  emit('update:visible', false)
}

function cancel(): void {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="header || t('recordDetails.actionPromptHeader', 'Enter value')"
    :style="{ width: '26rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-2">
      <label class="text-surface-700 text-[0.85rem] font-semibold">
        {{ label || t('recordDetails.actionPromptMultiplier', 'Multiplier') }}
      </label>
      <InputNumber
        v-model="value"
        fluid
        :min-fraction-digits="0"
        :max-fraction-digits="6"
        autofocus
      />
    </div>

    <template #footer>
      <Button
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        outlined
        @click="cancel"
      />
      <Button
        :label="confirmLabel || t('recordDetails.runAction', 'Run')"
        :disabled="!canConfirm()"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>
