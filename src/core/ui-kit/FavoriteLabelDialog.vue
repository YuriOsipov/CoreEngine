<script lang="ts">
export default {
  name: 'FavoriteLabelDialog',
}
</script>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  visible: boolean
  initialLabel: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: [label: string]
}>()

const { t } = useTranslation()
const label = ref('')

watch(
  () => props.initialLabel,
  (value) => {
    label.value = value
  },
  { immediate: true },
)

watch(
  () => props.visible,
  (visible) => {
    if (visible) label.value = props.initialLabel
  },
)

function confirm(): void {
  const trimmed = label.value.trim()
  if (!trimmed) return
  emit('confirm', trimmed)
  emit('update:visible', false)
}

function cancel(): void {
  emit('update:visible', false)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') confirm()
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="t('navigation.favoriteDialogTitle', 'Add to favorites')"
    :style="{ width: '26rem' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-2">
      <label class="text-surface-700 text-[0.85rem] font-semibold">
        {{ t('navigation.favoriteLabel', 'Label') }}
      </label>
      <InputText
        v-model="label"
        fluid
        autofocus
        @keydown="handleKeydown"
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
        :label="t('navigation.favoriteAdd', 'Add to favorites')"
        :disabled="!label.trim()"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>
