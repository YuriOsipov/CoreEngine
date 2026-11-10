<script lang="ts">
export default {
  name: 'DocViewDialog',
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { generateDocumentPdfBlob } from '@docengine/editor'
import '@docengine/editor/styles.css'
import '@docengine/editor/themes/bridge.css'
import '@docengine/editor/themes/prime.css'
import '@/core/styles/doc-editor-theme.css'
import { useToast } from 'openvue/usetoast'
import { currentUserRole } from '@/core/currentUser'
import { useTranslation } from '@/core/translation'
import type { DocEngineExportMode } from '@/interfaces/documents'
import { buildDocumentExportFile } from '@/modules/documents/services/docExportArtifact'
import {
  mountDocumentHtmlPreview,
  printDocumentHtmlPreview,
} from '@/modules/documents/services/docHtmlPreview'
import { buildPopulatedDocument } from '@/modules/documents/services/docPopulation'
import { loadDocTemplateById } from '@/modules/documents/services/docTemplateService'
import { canAccessDocTemplate } from '@/modules/documents/services/docTemplateRole'
import { resolveSnapshotIdForPin } from '@/modules/documents/services/docTemplateSnapshotService'
import { loadDocValueById, saveDocValue } from '@/modules/documents/services/docValueService'

const props = withDefaults(
  defineProps<{
    visible: boolean
    collection: string
    recordId: string
    templateId: string
    docValueId?: string | null
    viewMode?: DocEngineExportMode
    autoSave?: boolean
  }>(),
  {
    docValueId: null,
    viewMode: 'html',
    autoSave: false,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: [docValueId: string]
}>()

const { t } = useTranslation()
const toast = useToast()

const previewHost = ref<HTMLElement | null>(null)
const pdfUrl = ref<string | null>(null)
const documentName = ref('')
const loading = ref(false)
const exporting = ref(false)
const error = ref<string | null>(null)
const populatedDoc = ref<Record<string, unknown> | null>(null)
const hideEmptyValues = ref(false)
const displayMode = ref<DocEngineExportMode>('html')
const savedDocValueId = ref<string | null>(null)

let previewRoot: HTMLElement | null = null

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const canExport = computed(
  () => !loading.value && !exporting.value && populatedDoc.value != null && !error.value,
)

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
  await nextTick()
  const host = previewHost.value
  if (!host) return
  previewRoot = mountDocumentHtmlPreview(host, doc, {
    hideEmptyValues: hideEmptyValues.value,
  })
}

async function renderPdfPreview(doc: Record<string, unknown>): Promise<void> {
  clearPreview()
  const blob = await generateDocumentPdfBlob(doc as never, {
    download: false,
  })
  pdfUrl.value = URL.createObjectURL(blob)
}

async function paintPreview(): Promise<void> {
  const doc = populatedDoc.value
  if (!doc || !props.visible) return
  if (displayMode.value === 'pdf') {
    await renderPdfPreview(doc)
  } else {
    await renderHtmlPreview(doc)
  }
}

async function loadDocumentView(): Promise<void> {
  if (!props.visible || !props.collection || !props.recordId || !props.templateId) return

  loading.value = true
  error.value = null
  populatedDoc.value = null
  savedDocValueId.value = props.docValueId ? String(props.docValueId) : null
  displayMode.value = props.viewMode === 'pdf' ? 'pdf' : 'html'
  clearPreview()

  try {
    const templateRecord = await loadDocTemplateById(props.templateId)
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
    if (props.docValueId) {
      const docValueRecord = await loadDocValueById(props.docValueId)
      if (!docValueRecord) {
        throw new Error(t('documents.documentNotFound', 'Document not found.'))
      }
      savedValues = docValueRecord.values ?? null
      savedDocValueId.value = props.docValueId
    }

    const populated = await buildPopulatedDocument(
      props.collection,
      props.recordId,
      templateRecord,
      savedValues,
    )

    const doc = {
      time: populated.time,
      blocks: populated.blocks,
      fieldSchemas: populated.fieldSchemas,
      pageSetup: populated.pageSetup,
      ...(populated.sections ? { sections: populated.sections } : {}),
      ...(populated.repeatableSectionInstances
        ? { repeatableSectionInstances: populated.repeatableSectionInstances }
        : {}),
    }
    populatedDoc.value = doc

    if (
      props.autoSave &&
      !props.docValueId &&
      populated.fieldsExport &&
      Object.keys(populated.fieldsExport).length > 0
    ) {
      const snapshotId = await resolveSnapshotIdForPin(props.templateId)
      const saved = await saveDocValue({
        templateId: props.templateId,
        parentCollection: props.collection,
        parentId: props.recordId,
        values: populated.fieldsExport,
        documentStatus: 'completed',
        templateSnapshotId: snapshotId,
        completedDate: new Date().toISOString(),
      })
      savedDocValueId.value = String(saved.id)
      emit('saved', String(saved.id))
    }

    await paintPreview()
  } catch (err) {
    populatedDoc.value = null
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

function onPrint(): void {
  const doc = populatedDoc.value
  if (!doc) return
  try {
    printDocumentHtmlPreview(
      doc,
      documentName.value || t('documents.viewDocument', 'View document'),
    )
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('documents.printError', 'Failed to prepare the document for printing.'),
      life: 5000,
    })
  }
}

async function onSave(): Promise<void> {
  const doc = populatedDoc.value
  if (!doc || exporting.value) return

  exporting.value = true
  try {
    const file = await buildDocumentExportFile(doc, {
      mode: displayMode.value,
      title: documentName.value || t('documents.viewDocument', 'View document'),
    })
    const url = URL.createObjectURL(file)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    anchor.click()
    URL.revokeObjectURL(url)
    toast.add({
      severity: 'success',
      summary: t('documents.saved', 'Saved'),
      detail: t('documents.documentDownloaded', 'Document downloaded.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('documents.saveDocumentError', 'Failed to save document.'),
      life: 5000,
    })
  } finally {
    exporting.value = false
  }
}

async function onToggleDisplayMode(): Promise<void> {
  displayMode.value = displayMode.value === 'pdf' ? 'html' : 'pdf'
  if (!populatedDoc.value) return
  loading.value = true
  try {
    await paintPreview()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('documents.loadViewError', 'Failed to render document.'),
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

watch(
  () =>
    [
      props.visible,
      props.collection,
      props.recordId,
      props.templateId,
      props.docValueId ?? '',
      props.viewMode,
      props.autoSave,
    ] as const,
  ([visible]) => {
    if (!visible) {
      clearPreview()
      error.value = null
      populatedDoc.value = null
      hideEmptyValues.value = false
      return
    }
    void loadDocumentView()
  },
  { immediate: true },
)

watch(hideEmptyValues, () => {
  if (!props.visible || !populatedDoc.value || displayMode.value !== 'html') return
  void renderHtmlPreview(populatedDoc.value)
})

onBeforeUnmount(() => {
  clearPreview()
})
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    maximizable
    class="doc-view-dialog"
    :header="t('documents.documentPreview', 'Document preview')"
    :style="{ width: 'min(1100px, 96vw)', height: '90vh' }"
    :content-style="{
      display: 'flex',
      flexDirection: 'column',
      flex: '1 1 auto',
      minHeight: 0,
      overflow: 'hidden',
      padding: '0.75rem',
    }"
  >
    <Message
      v-if="error"
      severity="error"
      :closable="false"
      class="mb-2 shrink-0"
    >
      {{ error }}
    </Message>

    <div class="doc-view-dialog__preview relative min-h-0 flex-1 overflow-hidden">
      <div
        v-if="loading"
        class="page-loading absolute inset-0 z-10 bg-surface-0/80"
      >
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('documents.renderingDocument', 'Rendering document...') }}</span>
      </div>

      <div
        v-if="displayMode === 'html'"
        ref="previewHost"
        class="doc-view-preview preview-modal__body preview-modal__body--html absolute inset-0"
      />

      <iframe
        v-else-if="pdfUrl"
        :src="pdfUrl"
        class="doc-view-dialog__pdf absolute inset-0 h-full w-full rounded-lg border border-surface-200 bg-surface-0"
        :title="documentName || t('documents.documentPreview', 'Document preview')"
      />
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2 flex-wrap">
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              v-model="hideEmptyValues"
              binary
              :disabled="loading || displayMode !== 'html'"
            />
            <span>{{ t('documents.hideEmptyValues', 'Hide empty values') }}</span>
          </label>
          <Button
            type="button"
            :label="
              displayMode === 'pdf'
                ? t('documents.viewAsHtml', 'View as HTML')
                : t('documents.viewAsPdf', 'View as PDF')
            "
            severity="secondary"
            outlined
            :disabled="!canExport"
            @click="onToggleDisplayMode"
          />
          <Button
            type="button"
            icon="pi pi-print"
            severity="secondary"
            outlined
            v-tooltip.top="t('documents.print', 'Print')"
            :aria-label="t('documents.print', 'Print')"
            :disabled="!canExport"
            @click="onPrint"
          />
          <Button
            type="button"
            icon="pi pi-download"
            severity="secondary"
            outlined
            v-tooltip.top="t('common.save', 'Save')"
            :aria-label="t('common.save', 'Save')"
            :loading="exporting"
            :disabled="!canExport"
            @click="onSave"
          />
        </div>
        <Button
          :label="t('common.close', 'Close')"
          @click="dialogVisible = false"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
:deep(.doc-view-dialog.p-dialog),
:deep(.p-dialog.doc-view-dialog) {
  display: flex;
  flex-direction: column;
  max-height: 95vh;
}

:deep(.doc-view-dialog.p-dialog-maximized),
:deep(.p-dialog.doc-view-dialog.p-dialog-maximized) {
  max-height: 100vh;
  height: 100vh !important;
}

:deep(.doc-view-dialog .p-dialog-header),
:deep(.doc-view-dialog .p-dialog-footer) {
  flex-shrink: 0;
}

:deep(.doc-view-dialog .p-dialog-content) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.doc-view-dialog__preview {
  min-height: 0;
}

.doc-view-preview.preview-modal__body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.doc-view-preview .preview-modal__html {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
