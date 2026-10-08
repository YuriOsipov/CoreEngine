<script setup lang="ts">
import { computed } from 'vue'
import { Dropdown as FloatingDropdown } from 'floating-vue'
import { normalizeHtmlContent } from '@/core/htmlContent'

const props = withDefaults(
  defineProps<{
    html?: string | null
    lineClamp?: number
    emptyLabel?: string
  }>(),
  {
    html: '',
    lineClamp: 2,
    emptyLabel: '-',
  },
)

const content = computed(() => normalizeHtmlContent(props.html))
const hasContent = computed(() => content.value.trim().length > 0)
const clampClass = computed(() => {
  const lines = Math.max(1, props.lineClamp)
  if (lines === 1) return 'line-clamp-1'
  if (lines === 2) return 'line-clamp-2'
  if (lines === 3) return 'line-clamp-3'
  return 'line-clamp-2'
})
</script>

<template>
  <span v-if="!hasContent" class="text-muted-color">{{ emptyLabel }}</span>
  <FloatingDropdown
    v-else
    theme="compact-record"
    placement="top-start"
    :distance="8"
    :delay="{ show: 250, hide: 150 }"
    :triggers="['hover', 'focus']"
    :popper-triggers="['hover']"
  >
    <div
      class="crm-rendered-html crm-html-cell break-words"
      :class="clampClass"
      v-html="content"
    />

    <template #popper>
      <div class="crm-rendered-html crm-html-cell__tooltip max-w-md p-3 text-sm leading-relaxed" v-html="content" />
    </template>
  </FloatingDropdown>
</template>
