<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'

const props = withDefaults(
  defineProps<{
    value?: string | null
    /** Visible lines when collapsed (scroll within this height). */
    lines?: number
    emptyLabel?: string
  }>(),
  {
    value: '',
    lines: 3,
    emptyLabel: '-',
  },
)

const { t } = useTranslation()

const text = computed(() => {
  if (props.value == null) return ''
  return String(props.value)
})
const hasContent = computed(() => text.value.trim().length > 0)

const expanded = ref(false)
const overflow = ref(false)
const bodyRef = ref<HTMLElement | null>(null)

const lineCount = computed(() => Math.min(6, Math.max(2, Math.round(props.lines))))

const collapsedMaxHeight = computed(() => `calc(1.35em * ${lineCount.value})`)

function measureOverflow(): void {
  const el = bodyRef.value
  if (!el || expanded.value) {
    overflow.value = false
    return
  }
  // Allow 1px tolerance for sub-pixel rounding.
  overflow.value = el.scrollHeight > el.clientHeight + 1
}

async function remeasure(): Promise<void> {
  await nextTick()
  measureOverflow()
}

function toggleExpanded(): void {
  expanded.value = !expanded.value
  void remeasure()
}

let resizeObserver: ResizeObserver | null = null

function observeBody(): void {
  resizeObserver?.disconnect()
  if (typeof ResizeObserver === 'undefined' || !bodyRef.value) return
  resizeObserver = new ResizeObserver(() => {
    measureOverflow()
  })
  resizeObserver.observe(bodyRef.value)
}

onMounted(() => {
  observeBody()
  void remeasure()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

watch(bodyRef, () => {
  observeBody()
  void remeasure()
})

watch(
  () => [text.value, props.lines, expanded.value] as const,
  () => {
    void remeasure()
  },
)
</script>

<template>
  <span v-if="!hasContent" class="text-muted-color">{{ emptyLabel }}</span>
  <div v-else class="crm-textarea-cell flex min-w-0 flex-col gap-1">
    <div
      ref="bodyRef"
      class="crm-textarea-cell__body min-w-0 break-words whitespace-pre-wrap text-ink text-[0.95rem] leading-[1.35]"
      :class="{ 'crm-textarea-cell__body--collapsed': !expanded }"
      :style="expanded ? undefined : { maxHeight: collapsedMaxHeight }"
    >
      {{ text }}
    </div>
    <button
      v-if="overflow || expanded"
      type="button"
      class="crm-textarea-cell__toggle self-start border-0 bg-transparent p-0 text-primary text-xs cursor-pointer underline decoration-dotted underline-offset-[3px]"
      :aria-expanded="expanded"
      @click="toggleExpanded"
    >
      {{
        expanded
          ? t('formRenderer.showLess', 'Show less')
          : t('formRenderer.showMore', 'Show more')
      }}
    </button>
  </div>
</template>

<style scoped>
.crm-textarea-cell__body--collapsed {
  overflow-y: auto;
}
</style>
