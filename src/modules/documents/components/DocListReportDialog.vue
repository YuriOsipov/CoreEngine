<script lang="ts">
export default {
  name: 'DocListReportDialog',
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { generateDocumentPdfBlob } from '@docengine/editor'
import '@docengine/editor/styles.css'
import '@docengine/editor/themes/bridge.css'
import '@docengine/editor/themes/prime.css'
import '@/core/styles/doc-editor-theme.css'
import { useToast } from 'openvue/usetoast'
import { currentUserRole } from '@/core/currentUser'
import { useTranslation } from '@/core/translation'
import type { DocEngineExportMode } from '@/interfaces/documents'
import {
  mountDocumentHtmlPreview,
  printDocumentHtmlPreview,
} from '@/modules/documents/services/docHtmlPreview'
import { buildDocumentExportFile } from '@/modules/documents/services/docExportArtifact'
import {
  buildPopulatedDocumentFromList,
  DOC_LIST_REPORT_MAX_RECORDS,
  type DocListFilterMetaBlock,
} from '@/modules/documents/services/docPopulation'
import { loadDocTemplateByIdForCurrentUser } from '@/modules/documents/services/docTemplateService'
import { canAccessDocTemplate } from '@/modules/documents/services/docTemplateRole'

const props = withDefaults(
  defineProps<{
    visible: boolean
    collection: string
    recordIds: string[]
    templateId: string
    viewMode?: DocEngineExportMode
    filter?: DocListFilterMetaBlock | null
    parent?: Record<string, unknown> | null
    viewLabel?: string | null
  }>(),
  {
    viewMode: 'pdf',
    filter: null,
    parent: null,
    viewLabel: null,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
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
let previewRoot: HTMLElement | null = null

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

const mode = computed(() => (props.viewMode === 'html' ? 'html' : 'pdf'))

const truncated = computed(
  () => props.recordIds.length > DOC_LIST_REPORT_MAX_RECORDS,
)

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

async function loadReport(): Promise<void> {
  if (!props.visible || !props.collection || !props.templateId) return
  if (props.recordIds.length === 0) {
    error.value = t('documents.listReportNoRecords', 'No records to include in the report.')
    populatedDoc.value = null
    return
  }

  loading.value = true
  error.value = null
  populatedDoc.value = null
  clearPreview()

  try {
    const templateRecord = await loadDocTemplateByIdForCurrentUser(props.templateId)
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

    const populated = await buildPopulatedDocumentFromList(
      props.collection,
      props.recordIds,
      templateRecord,
      {
        filter: props.filter,
        parent: props.parent,
        viewLabel: props.viewLabel,
      },
    )

    const doc = {
      time: populated.time,
      blocks: populated.blocks,
      fieldSchemas: populated.fieldSchemas,
      pageSetup: populated.pageSetup,
    }
    populatedDoc.value = doc

    if (mode.value === 'pdf') {
      await renderPdfPreview(doc)
    } else {
      await renderHtmlPreview(doc)
    }
  } catch (err) {
    populatedDoc.value = null
    error.value =
      err instanceof Error
        ? err.message
        : t('documents.listReportError', 'Failed to generate list report.')
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
      documentName.value || t('documents.listReport', 'List report'),
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
      mode: mode.value,
      title: documentName.value || t('documents.listReport', 'List report'),
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
      detail: t('documents.listReportSaved', 'Report downloaded.'),
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

watch(
  () =>
    [
      props.visible,
      props.collection,
      props.templateId,
      props.viewMode,
      props.recordIds.join(','),
    ] as const,
  ([visible]) => {
    if (!visible) {
      clearPreview()
      error.value = null
      populatedDoc.value = null
      return
    }
    void loadReport()
  },
)

onBeforeUnmount(() => {
  clearPreview()
})
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    maximizable
    :header="documentName || t('documents.listReport', 'List report')"
    :style="{ width: 'min(1100px, 96vw)' }"
    :content-style="{ minHeight: '60vh' }"
  >
    <Message
      v-if="truncated"
      severity="warn"
      :closable="false"
      class="mb-3"
    >
      {{
        t(
          'documents.listReportTruncated',
          'Report limited to the first {max} records.',
          { max: DOC_LIST_REPORT_MAX_RECORDS },
        )
      }}
    </Message>

    <Message
      v-if="error"
      severity="error"
      :closable="false"
      class="mb-3"
    >
      {{ error }}
    </Message>

    <div class="relative min-h-[50vh]">
      <div
        v-if="loading"
        class="page-loading absolute inset-0 z-10 bg-surface-0/80"
      >
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('documents.renderingDocument', 'Rendering document...') }}</span>
      </div>

      <div
        v-if="mode === 'html'"
        ref="previewHost"
        class="doc-view-preview preview-modal__body preview-modal__body--html min-h-[50vh]"
      />

      <iframe
        v-else-if="pdfUrl"
        :src="pdfUrl"
        class="min-h-[50vh] w-full rounded-lg border border-surface-200 bg-surface-0"
        :title="documentName"
      />
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-2">
          <Button
            type="button"
            :label="t('documents.print', 'Print')"
            icon="pi pi-print"
            severity="secondary"
            outlined
            :disabled="!canExport"
            @click="onPrint"
          />
          <Button
            type="button"
            :label="t('common.save', 'Save')"
            icon="pi pi-download"
            severity="secondary"
            outlined
            :loading="exporting"
            :disabled="!canExport"
            @click="onSave"
          />
        </div>
        <Button
          :label="t('common.close', 'Close')"
          severity="secondary"
          text
          @click="dialogVisible = false"
        />
      </div>
    </template>
  </Dialog>
</template>
