<script lang="ts">
export default {
  name: 'DocFillPage',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DocFillDialog from '@/modules/documents/components/DocFillDialog.vue'
import { loadDocTemplateById } from '@/modules/documents/services/docTemplateService'
import type { DocEngineExportMode } from '@/interfaces/documents'

const route = useRoute()
const router = useRouter()

const collectionName = computed(() => String(route.params.collection ?? ''))
const recordId = computed(() => String(route.params.id ?? ''))
const templateId = computed(() => String(route.query.template ?? ''))
const docValueId = computed(() => {
  const raw = route.query.docValue
  return raw ? String(raw) : null
})
const exportMode = computed<DocEngineExportMode>(() =>
  route.query.mode === 'html' ? 'html' : 'pdf',
)
const attachFile = ref(true)

const visible = ref(true)

const backRoute = computed(() => `/object/${collectionName.value}/${recordId.value}`)

watch(visible, (open) => {
  if (!open) {
    void router.push(backRoute.value)
  }
})

watch(
  templateId,
  (id) => {
    attachFile.value = true
    if (!id) return
    void loadDocTemplateById(id).then((tmpl) => {
      if (!tmpl || templateId.value !== id) return
      attachFile.value = tmpl.attach_file !== false
    })
  },
  { immediate: true },
)
</script>

<template>
  <main class="app-shell">
    <DocFillDialog
      v-if="templateId"
      v-model:visible="visible"
      :collection="collectionName"
      :record-id="recordId"
      :template-id="templateId"
      :doc-value-id="docValueId"
      :export-mode="exportMode"
      :attach-file="attachFile"
    />
  </main>
</template>
