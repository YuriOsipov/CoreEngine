<script lang="ts">
export default {
  name: 'DocViewPage',
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import { generateDocumentPdfBlob } from '@docengine/editor'
import '@docengine/editor/styles.css'
import '@docengine/editor/themes/bridge.css'
import '@docengine/editor/themes/prime.css'
import '@/core/styles/doc-editor-theme.css'
import AppHeaderUtilities from '@/core/ui-kit/AppHeaderUtilities.vue'
import { currentUserRole } from '@/core/currentUser'
import { useTranslation } from '@/core/translation'
import { normalizeDocDocumentStatus, type DocDocumentStatus } from '@/interfaces/documents'
import { mountDocumentHtmlPreview } from '@/modules/documents/services/docHtmlPreview'
import { buildPopulatedDocument } from '@/modules/documents/services/docPopulation'
import { loadDocTemplateById } from '@/modules/documents/services/docTemplateService'
import { canAccessDocTemplate } from '@/modules/documents/services/docTemplateRole'
import { resolveSnapshotIdForPin } from '@/modules/documents/services/docTemplateSnapshotService'
import { loadDocValueById, saveDocValue } from '@/modules/documents/services/docValueService'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { t } = useTranslation()

const collectionName = computed(() => String(route.params.collection ?? ''))
const recordId = computed(() => String(route.params.id ?? ''))
const templateId = computed(() => String(route.query.template ?? ''))
const docValueId = computed(() => String(route.query.docValue ?? ''))
const viewMode = computed(() =>
  route.query.mode === 'pdf' ? 'pdf' : 'html',
)
const autoSave = computed(() => route.query.autoSave === '1')

const previewHost = ref<HTMLElement | null>(null)
const pdfUrl = ref<string | null>(null)
const documentName = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const savedDocValueId = ref<string | null>(null)
const documentStatus = ref<DocDocumentStatus | null>(null)

let previewRoot: HTMLElement | null = null

const backRoute = computed(() => `/object/${collectionName.value}/${recordId.value}`)

const fillRoute = computed(() => ({
  name: 'document-fill' as const,
  params: {
    collection: collectionName.value,
    id: recordId.value,
  },
  query: {
    template: templateId.value,
    ...(savedDocValueId.value || docValueId.value
      ? { docValue: savedDocValueId.value || docValueId.value }
      : {}),
  },
}))

function revokePdfUrl(): void {
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value)
    pdfUrl.value = null
  }
}

function clearPreview(): void {
  previewRoot?.remove()
  previewRoot = null
  revokePdfUrl()
}

async function renderHtmlPreview(doc: Record<string, unknown>): Promise<void> {
  clearPreview()
  const host = previewHost.value
  if (!host) return
  previewRoot = mountDocumentHtmlPreview(host, doc, { hideEmptyValues: false })
}

async function renderPdfPreview(doc: Record<string, unknown>): Promise<void> {
  clearPreview()
  const blob = await generateDocumentPdfBlob(doc as never, {
    title: documentName.value || 'document',
    download: false,
  })
  pdfUrl.value = URL.createObjectURL(blob)
}

async function loadDocumentView(): Promise<void> {
  if (!collectionName.value || !recordId.value || !templateId.value) return

  loading.value = true
  error.value = null
  documentStatus.value = null
  clearPreview()

  try {
    const templateRecord = await loadDocTemplateById(templateId.value)
    if (!templateRecord?.body) {
      throw new Error(t('documents.templateNotFound', 'Document template not found.'))
    }

    const roleId = await currentUserRole()
    if (!canAccessDocTemplate(templateRecord, roleId)) {
      throw new Error(
        t(
          'documents.templateAccessDenied',
          'You do not have access to this document template.',
        ),
      )
    }

    documentName.value = templateRecord.name

    let savedValues: Record<string, unknown> | null = null
    if (docValueId.value) {
      const docValueRecord = await loadDocValueById(docValueId.value)
      if (!docValueRecord) {
        throw new Error(t('documents.documentNotFound', 'Document not found.'))
      }
      savedValues = docValueRecord.values ?? null
      savedDocValueId.value = docValueId.value
      documentStatus.value = normalizeDocDocumentStatus(docValueRecord.document_status)
    } else {
      documentStatus.value = null
    }

    const populated = await buildPopulatedDocument(
      collectionName.value,
      recordId.value,
      templateRecord,
      savedValues,
    )

    const doc = {
      time: populated.time,
      blocks: populated.blocks,
      fieldSchemas: populated.fieldSchemas,
      pageSetup: populated.pageSetup,
    }

    if (
      autoSave.value &&
      !docValueId.value &&
      populated.fieldsExport &&
      Object.keys(populated.fieldsExport).length > 0
    ) {
      const snapshotId = await resolveSnapshotIdForPin(templateId.value)
      const saved = await saveDocValue({
        templateId: templateId.value,
        parentCollection: collectionName.value,
        parentId: recordId.value,
        values: populated.fieldsExport,
        documentStatus: 'completed',
        templateSnapshotId: snapshotId,
        completedDate: new Date().toISOString(),
      })
      savedDocValueId.value = String(saved.id)
      documentStatus.value = 'completed'
    }

    if (viewMode.value === 'pdf') {
      await renderPdfPreview(doc)
    } else {
      await renderHtmlPreview(doc)
    }
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('documents.loadViewError', 'Failed to render document.')
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: error.value,
      life: 6000,
    })
  } finally {
    loading.value = false
  }
}

watch(
  [collectionName, recordId, templateId, docValueId, viewMode],
  () => {
    void loadDocumentView()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearPreview()
})
</script>

<template>
  <main class="app-shell">
    <header class="app-header app-header--integrated">
      <div class="app-header__nav-row">
        <RouterLink
          :to="backRoute"
          class="nav-link"
        >
          {{ t('recordDetails.backTo', 'Back to {label}', { label: collectionName }) }}
        </RouterLink>
        <AppHeaderUtilities />
      </div>
      <div class="app-header__row">
        <h1 class="m-0">
          {{ documentName || t('documents.viewDocument', 'View document') }}
        </h1>
        <div class="app-header-actions">
          <Button
            v-if="documentStatus !== 'completed'"
            type="button"
            :label="t('documents.editDocument', 'Edit')"
            icon="pi pi-pencil"
            size="small"
            severity="secondary"
            outlined
            :disabled="loading"
            @click="router.push(fillRoute)"
          />
        </div>
      </div>
    </header>

    <section class="workspace-pane flex min-h-0 flex-1 flex-col overflow-hidden">
      <Message
        v-if="error"
        severity="error"
        :closable="false"
        class="mb-3"
      >
        {{ error }}
      </Message>

      <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          v-if="loading"
          class="page-loading absolute inset-0 z-10 bg-surface-0/80"
        >
          <ProgressSpinner stroke-width="4" />
          <span>{{ t('documents.renderingDocument', 'Rendering document...') }}</span>
        </div>

        <div
          v-if="viewMode === 'html'"
          ref="previewHost"
          class="doc-view-preview preview-modal__body preview-modal__body--html min-h-0 flex-1"
        />

        <iframe
          v-else-if="pdfUrl"
          :src="pdfUrl"
          class="min-h-0 flex-1 rounded-lg border border-surface-200 bg-surface-0"
          :title="documentName"
        />
      </div>
    </section>
  </main>
</template>

<style scoped>
.workspace-pane {
  min-height: calc(100vh - 8rem);
}

</style>
