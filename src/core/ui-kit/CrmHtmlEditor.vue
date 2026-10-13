<script setup lang="ts">
import Editor from 'openvue/editor'

withDefaults(
  defineProps<{
    modelValue?: string | null
    disabled?: boolean
    id?: string
    editorStyle?: string
    placeholder?: string
  }>(),
  {
    modelValue: '',
    editorStyle: 'min-height: 200px',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function onUpdate(value: string): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <div
    v-if="disabled"
    :id="id"
    class="html-editor-readonly min-h-[2.35rem] break-words border border-surface-200 rounded-md bg-surface-50 text-surface-900 px-[0.65rem] py-[0.55rem] text-[0.95rem] leading-[1.35]"
    v-html="modelValue || ''"
  />
  <Editor
    v-else
    :id="id"
    :model-value="modelValue ?? ''"
    :editor-style="editorStyle"
    :placeholder="placeholder"
    @update:model-value="onUpdate"
  />
</template>

<style scoped>
.html-editor-readonly :deep(p) {
  margin: 0 0 0.5rem;
}

.html-editor-readonly :deep(p:last-child) {
  margin-bottom: 0;
}

.html-editor-readonly :deep(ul),
.html-editor-readonly :deep(ol) {
  margin: 0 0 0.5rem;
  padding-left: 1.25rem;
}
</style>
