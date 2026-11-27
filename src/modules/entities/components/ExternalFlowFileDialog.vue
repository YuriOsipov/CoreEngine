<script lang="ts">
export default {
  name: 'ExternalFlowFileDialog',
}
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useTranslation } from '@/core/translation'

const props = defineProps<{
  visible: boolean
  file: File | null
  saving: boolean
  allowSave?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: []
}>()

const { t } = useTranslation()
const objectUrl = ref('')
const textPreview = ref('')

const kind = computed<'pdf' | 'image' | 'text' | 'other'>(() => {
  const type = props.file?.type || ''
  if (type === 'application/pdf') return 'pdf'
  if (type.startsWith('image/')) return 'image'
  if (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type.endsWith('+xml') ||
    type.endsWith('+json')
  ) {
    return 'text'
  }
  return 'other'
})

function revokeUrl(): void {
  if (!objectUrl.value) return
  URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = ''
}

watch(
  () => props.file,
  (file) => {
    revokeUrl()
    textPreview.value = ''
    if (!file) return
    objectUrl.value = URL.createObjectURL(file)
    if (kind.value === 'text') {
      void file.text().then((value) => {
        if (props.file === file) textPreview.value = value
      })
    }
  },
  { immediate: true },
)

onUnmounted(revokeUrl)

function onVisible(value: boolean): void {
  if (props.saving) return
  emit('update:visible', value)
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :closable="!saving"
    :header="file?.name || t('recordDetails.flowFilePreview', 'Response file')"
    :style="{ width: 'min(960px, 96vw)' }"
    @update:visible="onVisible"
  >
    <iframe
      v-if="kind === 'pdf' && objectUrl"
      class="w-full h-[70vh] border-0"
      :title="file?.name || t('recordDetails.flowFilePreview', 'Response file')"
      :src="objectUrl"
    />
    <img
      v-else-if="kind === 'image' && objectUrl"
      class="max-w-full max-h-[70vh] object-contain"
      :alt="file?.name || t('recordDetails.flowFilePreview', 'Response file')"
      :src="objectUrl"
    />
    <pre
      v-else-if="kind === 'text'"
      class="m-0 max-h-[70vh] overflow-auto whitespace-pre-wrap text-[0.85rem]"
    >{{ textPreview }}</pre>
    <p v-else class="m-0 text-muted-color text-[0.9rem]">
      {{
        t(
          'recordDetails.flowFilePreviewUnavailable',
          'Preview is not available for this file type.',
        )
      }}
    </p>
    <template v-if="allowSave" #footer>
      <Button
        :label="t('recordDetails.flowFileSave', 'Save to attachments')"
        icon="pi pi-paperclip"
        :loading="saving"
        :disabled="!file"
        @click="emit('save')"
      />
    </template>
  </Dialog>
</template>
