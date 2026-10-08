<script lang="ts">
export default {
  name: 'DocEngineField',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import type { LayoutFieldMetadata } from '@/interfaces'
import {
  normalizeDocEngineSettings,
  normalizeDocTemplateOutputFormat,
  type DocEngineExportMode,
  type DocTemplateOption,
  type DocValueListItem,
} from '@/interfaces'
import { readFilesByIds } from '@/core/graphql/filesProxy'
import { FILES_ASSET_FIELDS } from '@/core/filesField'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import { useTranslation } from '@/core/translation'
import type { FilePreviewData, FileUser } from '@/core/useFiles'
import FilePreview from '@/modules/entities/components/FilePreview.vue'
import DocFillDialog from '@/modules/documents/components/DocFillDialog.vue'
import DocTemplatePickerDialog from '@/modules/documents/components/DocTemplatePickerDialog.vue'
import {
  loadDocTemplateById,
  loadPublishedDocTemplateOptions,
} from '@/modules/documents/services/docTemplateService'
import {
  archiveDocValue,
  loadDocValueListItems,
} from '@/modules/documents/services/docValueService'

const props = withDefaults(
  defineProps<{
    field: LayoutFieldMetadata
    collection: string
    recordId: string | number
    active?: boolean
  }>(),
  { active: true },
)

const { t } = useTranslation()
const toast = useToast()
const confirm = useConfirm()

const settings = computed(() => normalizeDocEngineSettings(props.field.docEngine))
const documents = ref<DocValueListItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const templatePickerVisible = ref(false)
const templatePickerLoading = ref(false)
const publishedTemplates = ref<DocTemplateOption[]>([])

const fillVisible = ref(false)
const fillTemplateId = ref('')
const fillDocValueId = ref<string | null>(null)
const fillExportMode = ref<DocEngineExportMode>('pdf')
const fillAttachFile = ref(true)

const filePreviewVisible = ref(false)
const filePreviewData = ref<FilePreviewData | null>(null)
const filePreviewLoading = ref(false)

const parentId = computed(() => String(props.recordId ?? ''))

async function refreshList(): Promise<void> {
  if (!props.active || !props.collection || !parentId.value) {
    documents.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    documents.value = await loadDocValueListItems(
      props.collection,
      parentId.value,
      settings.value.templateId,
    )
  } catch (err) {
    documents.value = []
    error.value =
      err instanceof Error
        ? err.message
        : t('documents.loadDocumentsError', 'Failed to load documents.')
  } finally {
    loading.value = false
  }
}

watch(
  () =>
    [
      props.active,
      props.collection,
      parentId.value,
      settings.value.templateId,
    ].join('|'),
  () => {
    void refreshList()
  },
  { immediate: true },
)

function statusLabel(status: string): string {
  return status === 'completed'
    ? t('documents.statusCompleted', 'Completed')
    : t('documents.statusDraft', 'Draft')
}

function statusSeverity(status: string): 'success' | 'warn' | 'secondary' {
  return status === 'completed' ? 'success' : 'warn'
}

function formatDate(value: string | null): string {
  return formatLocalizedDateTime(value) || '—'
}

function openFill(templateId: string, docValueId?: string | null): void {
  fillTemplateId.value = templateId
  fillDocValueId.value = docValueId ?? null
  fillExportMode.value = 'pdf'
  fillAttachFile.value = true
  fillVisible.value = true

  void loadDocTemplateById(templateId).then((tmpl) => {
    if (!tmpl || fillTemplateId.value !== templateId) return
    fillExportMode.value = normalizeDocTemplateOutputFormat(tmpl.output_format)
    fillAttachFile.value = tmpl.attach_file !== false
  })
}

async function onNew(): Promise<void> {
  const fixedTemplateId = settings.value.templateId
  if (fixedTemplateId) {
    openFill(fixedTemplateId)
    return
  }

  templatePickerLoading.value = true
  templatePickerVisible.value = true
  try {
    publishedTemplates.value = await loadPublishedDocTemplateOptions(props.collection)
    if (publishedTemplates.value.length === 0) {
      templatePickerVisible.value = false
      toast.add({
        severity: 'warn',
        summary: t('documents.noTemplates', 'No document templates are available for this collection.'),
        life: 4000,
      })
      return
    }
    if (publishedTemplates.value.length === 1) {
      templatePickerVisible.value = false
      openFill(publishedTemplates.value[0]!.id)
    }
  } catch (err) {
    templatePickerVisible.value = false
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('documents.loadTemplatesError', 'Failed to load document templates.'),
      life: 5000,
    })
  } finally {
    templatePickerLoading.value = false
  }
}

function onTemplateSelected(templateId: string): void {
  openFill(templateId)
}

function onOpenRow(item: DocValueListItem): void {
  if (!item.templateId) return
  openFill(item.templateId, item.id)
}

function onDelete(item: DocValueListItem): void {
  confirm.require({
    message: t(
      'documents.deleteDocumentConfirm',
      'Delete document "{name}"?',
      { name: item.label },
    ),
    header: t('documents.deleteDocumentHeader', 'Delete document'),
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      text: true,
    },
    acceptProps: {
      label: t('common.delete', 'Delete'),
      severity: 'danger',
    },
    accept: () => {
      void (async () => {
        try {
          await archiveDocValue(item.id)
          toast.add({
            severity: 'success',
            summary: t('documents.documentDeleted', 'Document deleted'),
            life: 3000,
          })
          await refreshList()
        } catch (err) {
          toast.add({
            severity: 'error',
            summary: t('common.error', 'Error'),
            detail:
              err instanceof Error
                ? err.message
                : t('documents.deleteDocumentError', 'Failed to delete document.'),
            life: 5000,
          })
        }
      })()
    },
  })
}

async function openOutputFilePreview(fileId: string | null | undefined): Promise<void> {
  const id = String(fileId || '').trim()
  if (!id) return

  filePreviewLoading.value = true
  try {
    const rows = await readFilesByIds([id], [...FILES_ASSET_FIELDS])
    const row = rows[0]
    if (!row) {
      toast.add({
        severity: 'warn',
        summary: t('documents.previewFileMissing', 'Output file was not found.'),
        life: 4000,
      })
      return
    }
    filePreviewData.value = {
      id: String(row.id ?? id),
      filename_download:
        typeof row.filename_download === 'string' ? row.filename_download : undefined,
      type: typeof row.type === 'string' ? row.type : undefined,
      filesize: typeof row.filesize === 'number' ? row.filesize : undefined,
      created_on: typeof row.created_on === 'string' ? row.created_on : undefined,
      uploaded_by: (row.uploaded_by as FileUser) ?? null,
      title: typeof row.title === 'string' ? row.title : null,
      description: typeof row.description === 'string' ? row.description : null,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : null,
      location: typeof row.location === 'string' ? row.location : null,
      focal_point_x: typeof row.focal_point_x === 'number' ? row.focal_point_x : null,
      focal_point_y: typeof row.focal_point_y === 'number' ? row.focal_point_y : null,
      width: typeof row.width === 'number' ? row.width : null,
      height: typeof row.height === 'number' ? row.height : null,
    }
    filePreviewVisible.value = true
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('documents.previewFileError', 'Failed to open file preview.'),
      life: 5000,
    })
  } finally {
    filePreviewLoading.value = false
  }
}

function onFilePreviewUpdated(updated: FilePreviewData): void {
  filePreviewData.value = updated
}

async function onFillSaved(): Promise<void> {
  await refreshList()
}
</script>

<template>
  <div class="doc-engine-field flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="font-medium">{{ field.label }}</span>
      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          :label="t('documents.refresh', 'Refresh')"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          outlined
          :disabled="loading"
          @click="refreshList"
        />
        <Button
          type="button"
          :label="t('documents.newDocument', 'New document')"
          icon="pi pi-plus"
          size="small"
          :disabled="loading"
          @click="onNew"
        />
      </div>
    </div>

    <div
      v-if="loading"
      class="page-loading py-4"
    >
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('documents.loadingDocuments', 'Loading documents...') }}</span>
    </div>

    <Message
      v-else-if="error"
      severity="error"
      :closable="false"
    >
      {{ error }}
    </Message>

    <p
      v-else-if="documents.length === 0"
      class="text-color-secondary m-0"
    >
      {{
        t(
          'documents.noDocumentsYet',
          'No saved documents for this record yet. Click New document to generate one.',
        )
      }}
    </p>

    <DataTable
      v-else
      :value="documents"
      striped-rows
      row-hover
      size="small"
    >
      <Column
        field="label"
        :header="t('documents.template', 'Template')"
      >
        <template #body="{ data }">
          <Button
            type="button"
            link
            class="p-0"
            :label="data.label"
            @click="onOpenRow(data)"
          />
        </template>
      </Column>
      <Column
        field="documentStatus"
        :header="t('documents.status', 'Status')"
      >
        <template #body="{ data }">
          <Tag
            :severity="statusSeverity(data.documentStatus)"
            :value="statusLabel(data.documentStatus)"
          />
        </template>
      </Column>
      <Column
        field="completedDate"
        :header="t('documents.completedDate', 'Completed')"
      >
        <template #body="{ data }">
          {{ formatDate(data.completedDate) }}
        </template>
      </Column>
      <Column
        field="outputFileId"
        :header="t('documents.file', 'File')"
      >
        <template #body="{ data }">
          <button
            v-if="data.outputFileId"
            type="button"
            class="nav-link p-0 border-0 bg-transparent cursor-pointer"
            :disabled="filePreviewLoading"
            @click="openOutputFilePreview(data.outputFileId)"
          >
            {{ t('documents.previewFile', 'Preview') }}
          </button>
          <span v-else>—</span>
        </template>
      </Column>
      <Column
        field="dateUpdated"
        :header="t('documents.updated', 'Updated')"
      >
        <template #body="{ data }">
          {{ formatDate(data.dateUpdated) }}
        </template>
      </Column>
      <Column
        :header="t('common.edit', 'Actions')"
        style="width: 8rem"
      >
        <template #body="{ data }">
          <div class="flex gap-1">
            <Button
              type="button"
              :icon="data.documentStatus === 'completed' ? 'pi pi-eye' : 'pi pi-pencil'"
              size="small"
              text
              rounded
              :aria-label="
                data.documentStatus === 'completed'
                  ? t('documents.preview', 'Preview')
                  : t('common.edit', 'Edit')
              "
              @click="onOpenRow(data)"
            />
            <Button
              type="button"
              icon="pi pi-trash"
              size="small"
              text
              rounded
              severity="danger"
              :aria-label="t('common.delete', 'Delete')"
              @click="onDelete(data)"
            />
          </div>
        </template>
      </Column>
    </DataTable>

    <DocTemplatePickerDialog
      v-model:visible="templatePickerVisible"
      :templates="publishedTemplates"
      :loading="templatePickerLoading"
      @select="onTemplateSelected"
    />

    <DocFillDialog
      v-model:visible="fillVisible"
      :collection="collection"
      :record-id="parentId"
      :template-id="fillTemplateId"
      :doc-value-id="fillDocValueId"
      :export-mode="fillExportMode"
      :attach-file="fillAttachFile"
      @saved="onFillSaved"
    />

    <FilePreview
      v-model:visible="filePreviewVisible"
      :file="filePreviewData"
      @file-updated="onFilePreviewUpdated"
    />
  </div>
</template>
