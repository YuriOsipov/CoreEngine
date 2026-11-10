<script lang="ts">
export default {
  name: 'DocViewPage',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DocViewDialog from '@/modules/documents/components/DocViewDialog.vue'
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
const viewMode = computed<DocEngineExportMode>(() =>
  route.query.mode === 'pdf' ? 'pdf' : 'html',
)
const autoSave = computed(() => route.query.autoSave === '1')

const visible = ref(true)

const backRoute = computed(() => `/object/${collectionName.value}/${recordId.value}`)

watch(visible, (open) => {
  if (!open) {
    void router.push(backRoute.value)
  }
})
</script>

<template>
  <main class="app-shell">
    <DocViewDialog
      v-if="templateId"
      v-model:visible="visible"
      :collection="collectionName"
      :record-id="recordId"
      :template-id="templateId"
      :doc-value-id="docValueId"
      :view-mode="viewMode"
      :auto-save="autoSave"
    />
  </main>
</template>
