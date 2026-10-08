<script setup lang="ts">
import type { LookupHeaderItem } from './types'

defineProps<{
  label: string
  lookupHeaderItems: LookupHeaderItem[]
  computedTotals: Array<{ label: string; value: number }>
  loading: boolean
  submitting: boolean
  isConfigured: boolean
  pendingCount: number
  formatTransferValue: (value: unknown) => string
  refreshLabel: string
  submitLabel: string
}>()

const emit = defineEmits<{
  refresh: []
  submit: []
}>()
</script>

<template>
  <div class="flex items-center justify-between gap-3 w-full">
    <div class="flex items-center gap-2 min-w-0">
      <span class="font-semibold truncate">{{ label }}</span>
      <Tag
        v-for="item in lookupHeaderItems"
        :key="item.token"
        severity="info"
        class="shrink-0"
        :value="`${item.label}: ${formatTransferValue(item.value)}`"
      />
      <Tag
        v-for="total in computedTotals"
        :key="total.label"
        severity="secondary"
        class="shrink-0"
        :value="`${total.label}: ${formatTransferValue(total.value)}`"
      />
    </div>
    <div class="flex items-center gap-2">
      <Button
        :label="refreshLabel"
        size="small"
        text
        :disabled="loading || submitting"
        @click="emit('refresh')"
      />
      <Button
        v-if="isConfigured"
        :label="submitLabel"
        size="small"
        :loading="submitting"
        :disabled="pendingCount === 0 || loading"
        @click="emit('submit')"
      />
    </div>
  </div>
</template>
