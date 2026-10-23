<script lang="ts">
export default {
  name: 'DocFillDialog',
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import '@docengine/editor/styles.css'
import '@docengine/editor/themes/bridge.css'
import '@docengine/editor/themes/prime.css'
import '@/core/styles/doc-editor-theme.css'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import DocEditorHost from '@/core/ui-kit/DocEditorHost.vue'
import { useTranslation } from '@/core/translation'
import type { DocEngineExportMode, DocValueSetListItem } from '@/interfaces/documents'
import { useDocFillSession } from '../composables/useDocFillSession'
import { mountDocumentHtmlPreview, printDocumentHtmlPreview } from '../services/docHtmlPreview'
import {
  loadDocValueSetById,
  loadDocValueSetsForTemplate,
  saveDocValueSet,
} from '../services/docValueSetService'

const props = withDefaults(
  defineProps<{
    visible: boolean
    collection: string
    recordId: string
    templateId: string
    docValueId?: string | null
    exportMode?: DocEngineExportMode
    /** When false, finish skips attaching an export file. */
    attachFile?: boolean
  }>(),
  {
    docValueId: null,
    exportMode: 'pdf',
    attachFile: true,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: [docValueId: string, status: 'draft' | 'completed']
}>()

const { t } = useTranslation()
const toast = useToast()
const confirm = useConfirm()

const active = computed(() => props.visible && Boolean(props.templateId))
const exportModeRef = computed(() => (props.exportMode === 'html' ? 'html' : 'pdf' as const))
const attachFileRef = computed(() => props.attachFile !== false)
const docValueIdRef = computed(() => props.docValueId ?? null)

const {
  editorRef,
  documentName,
  editorNeeded,
  previewDocument,
  readOnly,
  loading,
  saving,
  error,
  dirty,
  canSaveDraft,
  saveDraft,
  finish,
  preview,
  exportScenarioValues,
  applyScenario,
} = useDocFillSession({
  collection: toRef(props, 'collection'),
  recordId: toRef(props, 'recordId'),
  templateId: toRef(props, 'templateId'),
  docValueId: docValueIdRef,
  exportMode: exportModeRef,
  attachFile: attachFileRef,
  active,
})

watch(error, (message) => {
  if (!message || !props.visible) return
  toast.add({
    severity: 'error',
    summary: t('common.error', 'Error'),
    detail: message,
    life: 6000,
  })
})

function requestClose(): void {
  if (saving.value) return
  if (!dirty.value) {
    emit('update:visible', false)
    return
  }
  confirm.require({
    message: t(
      'documents.discardChangesConfirm',
      'Discard unsaved changes to this document?',
    ),
    header: t('documents.discardChangesHeader', 'Unsaved changes'),
    rejectProps: {
      label: t('common.cancel', 'Cancel'),
      severity: 'secondary',
      text: true,
    },
    acceptProps: {
      label: t('documents.discard', 'Discard'),
      severity: 'danger',
    },
    accept: () => {
      emit('update:visible', false)
    },
  })
}

async function onSaveDraft(): Promise<void> {
  try {
    const id = await saveDraft()
    toast.add({
      severity: 'success',
      summary: t('documents.draftSaved', 'Draft saved'),
      life: 3000,
    })
    emit('saved', id, 'draft')
  } catch {
    /* toasted via error watch */
  }
}

async function onFinish(): Promise<void> {
  try {
    const id = await finish()
    toast.add({
      severity: 'success',
      summary: t('documents.finishedSaved', 'Document completed'),
      detail: props.attachFile !== false
        ? t(
          'documents.finishedSavedDetail',
          'Document saved and export attached to the record.',
        )
        : t('documents.finishedSavedDetailNoAttach', 'Document saved.'),
      life: 4000,
    })
    emit('saved', id, 'completed')
    emit('update:visible', false)
  } catch {
    /* toasted via error watch */
  }
}

async function onPreview(): Promise<void> {
  try {
    await preview()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('documents.previewError', 'Failed to open preview.'),
      life: 5000,
    })
  }
}

const previewHost = ref<HTMLElement | null>(null)
let previewRoot: HTMLElement | null = null

function clearHtmlPreview(): void {
  previewRoot?.remove()
  previewRoot = null
}

function paintHtmlPreview(): void {
  clearHtmlPreview()
  const host = previewHost.value
  const doc = previewDocument.value
  if (!props.visible || !readOnly.value || !host || !doc) return
  previewRoot = mountDocumentHtmlPreview(host, doc as unknown as Record<string, unknown>, {
    hideEmptyValues: false,
  })
}

watch([() => props.visible, readOnly, previewDocument, previewHost], () => {
  paintHtmlPreview()
})

onBeforeUnmount(() => {
  clearHtmlPreview()
})

function onPrint(): void {
  const doc = previewDocument.value
  if (!doc) return
  printDocumentHtmlPreview(
    doc as unknown as Record<string, unknown>,
    documentName.value || t('documents.viewDocument', 'View document'),
  )
}

const useScenario = ref(false)
const scenarios = ref<DocValueSetListItem[]>([])
const scenariosLoading = ref(false)
const selectedScenarioId = ref<string | null>(null)
const applyingScenario = ref(false)
const saveScenarioVisible = ref(false)
const scenarioName = ref('')
const scenarioDescription = ref('')
const savingScenario = ref(false)

const scenarioOptions = computed(() =>
  scenarios.value.map((item) => ({
    id: item.id,
    label: formatScenarioLabel(item),
  })),
)

function formatScenarioLabel(item: DocValueSetListItem): string {
  const description = item.description?.trim()
  return description ? `${item.name} — ${description}` : item.name
}

async function refreshScenarios(options?: { silent?: boolean }): Promise<void> {
  if (!props.visible || !props.templateId) {
    scenarios.value = []
    return
  }
  scenariosLoading.value = true
  try {
    scenarios.value = await loadDocValueSetsForTemplate(props.templateId)
  } catch (err) {
    if (options?.silent) return
    scenarios.value = []
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('documents.loadScenariosError', 'Failed to load scenarios.'),
      life: 5000,
    })
  } finally {
    scenariosLoading.value = false
  }
}

watch(
  () => [props.visible, props.templateId].join('|'),
  () => {
    useScenario.value = false
    selectedScenarioId.value = null
    scenarios.value = []
  },
)

watch(useScenario, (enabled) => {
  if (!enabled || !props.visible) return
  void refreshScenarios()
})

async function onLoadScenario(): Promise<void> {
  const id = selectedScenarioId.value?.trim()
  if (!id || readOnly.value) {
    toast.add({
      severity: 'warn',
      summary: t('documents.selectScenario', 'Select a scenario'),
      life: 3000,
    })
    return
  }
  applyingScenario.value = true
  try {
    const record = await loadDocValueSetById(id)
    if (!record) {
      throw new Error(t('documents.applyScenarioError', 'Failed to apply scenario.'))
    }
    await applyScenario(record.values)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('documents.applyScenarioError', 'Failed to apply scenario.'),
      life: 5000,
    })
  } finally {
    applyingScenario.value = false
  }
}

function openSaveScenario(): void {
  scenarioName.value = ''
  scenarioDescription.value = ''
  saveScenarioVisible.value = true
}

async function onConfirmSaveScenario(): Promise<void> {
  const name = scenarioName.value.trim()
  if (!name) {
    toast.add({
      severity: 'warn',
      summary: t('documents.scenarioNameRequired', 'Scenario name is required.'),
      life: 4000,
    })
    return
  }
  savingScenario.value = true
  try {
    const values = await exportScenarioValues()
    const saved = await saveDocValueSet({
      templateId: props.templateId,
      name,
      description: scenarioDescription.value,
      values,
    })
    selectedScenarioId.value = saved.record.id
    saveScenarioVisible.value = false
    await refreshScenarios({ silent: true })
    toast.add({
      severity: 'success',
      summary: saved.updated
        ? t('documents.scenarioUpdated', 'Scenario updated')
        : t('documents.scenarioSaved', 'Scenario saved'),
      detail: t(
        'documents.scenarioSavedDetail',
        'You can apply this scenario the next time you fill this template.',
      ),
      life: 4000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('documents.saveScenarioError', 'Failed to save scenario.'),
      life: 5000,
    })
  } finally {
    savingScenario.value = false
  }
}

function onDialogVisible(value: boolean): void {
  if (value) {
    emit('update:visible', true)
    return
  }
  requestClose()
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    maximizable
    class="doc-fill-dialog"
    :style="{ width: '95vw', height: '95vh' }"
    :content-style="{
      display: 'flex',
      flexDirection: 'column',
      flex: '1 1 auto',
      minHeight: 0,
      overflow: 'hidden',
      padding: '0.75rem',
    }"
    :closable="!saving"
    :close-on-escape="false"
    @update:visible="onDialogVisible"
  >
    <template #header>
      <div class="flex w-full flex-wrap items-center justify-between gap-2 pr-2">
        <div class="flex flex-wrap items-center gap-4">
          <span class="font-semibold">
            {{ documentName || t('documents.fillDocument', 'Fill document') }}
          </span>
          <label
            v-if="!readOnly"
            class="flex cursor-pointer items-center gap-2 text-sm font-normal"
          >
            <Checkbox
              v-model="useScenario"
              binary
              :disabled="loading || saving"
            />
            <span>{{ t('documents.useScenario', 'Use scenario') }}</span>
          </label>
        </div>
        <div
          v-if="!loading && !readOnly"
          class="flex flex-wrap items-center gap-2"
        >
          <Button
            type="button"
            :label="t('documents.preview', 'Preview')"
            icon="pi pi-eye"
            size="small"
            severity="secondary"
            outlined
            :disabled="loading || saving"
            @click="onPreview"
          />
          <Button
            v-if="canSaveDraft"
            type="button"
            :label="t('documents.saveDraft', 'Save Draft')"
            icon="pi pi-save"
            size="small"
            severity="secondary"
            :loading="saving"
            :disabled="loading || saving"
            @click="onSaveDraft"
          />
          <Button
            type="button"
            :label="t('documents.finish', 'Finish')"
            icon="pi pi-check"
            size="small"
            :loading="saving"
            :disabled="loading || saving"
            @click="onFinish"
          />
        </div>
      </div>
    </template>

    <Message
      v-if="error"
      severity="error"
      :closable="false"
      class="mb-2 shrink-0"
    >
      {{ error }}
    </Message>

    <div
      v-if="!readOnly && useScenario"
      class="mb-2 flex shrink-0 flex-col gap-1"
    >
      <span class="text-sm font-medium">{{ t('documents.scenario', 'Scenario') }}</span>
      <div class="flex flex-wrap items-center gap-2">
          <Select
            v-model="selectedScenarioId"
            :options="scenarioOptions"
            option-label="label"
            option-value="id"
            :placeholder="t('documents.selectScenario', 'Select a scenario')"
            :empty-message="t('documents.noScenarios', 'No saved scenarios for this template.')"
            :disabled="loading || saving || applyingScenario || savingScenario"
            :loading="scenariosLoading || applyingScenario"
            filter
            class="w-full max-w-xl"
          />
          <Button
            type="button"
            :label="t('documents.loadScenario', 'Load')"
            size="small"
            severity="secondary"
            outlined
            :loading="applyingScenario"
            :disabled="loading || saving || savingScenario || !selectedScenarioId"
            @click="onLoadScenario"
          />
          <Button
            type="button"
            :label="t('documents.saveScenarioAs', 'Save as')"
            size="small"
            :disabled="loading || saving || applyingScenario || savingScenario"
            @click="openSaveScenario"
          />
      </div>
    </div>

    <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        v-if="loading"
        class="page-loading absolute inset-0 z-10 bg-surface-0/80"
      >
        <ProgressSpinner stroke-width="4" />
        <span>{{
          readOnly
            ? t('documents.renderingDocument', 'Rendering document...')
            : t('documents.loadingEditor', 'Loading document editor...')
        }}</span>
      </div>

      <div
        v-if="readOnly"
        ref="previewHost"
        class="doc-fill-preview preview-modal__body preview-modal__body--html min-h-0 flex-1"
      />

      <DocEditorHost
        v-else-if="visible && templateId && editorNeeded"
        ref="editorRef"
        class="min-h-0 flex-1"
        :collection="collection"
        :record-id="recordId"
        :show-document-actions="false"
      />
    </div>

    <template #footer>
      <Button
        v-if="readOnly"
        type="button"
        :label="t('documents.print', 'Print')"
        icon="pi pi-print"
        :disabled="loading || !previewDocument"
        @click="onPrint"
      />
      <Button
        type="button"
        :label="readOnly ? t('documents.close', 'Close') : t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        :disabled="saving"
        @click="requestClose"
      />
    </template>
  </Dialog>

  <Dialog
    v-model:visible="saveScenarioVisible"
    modal
    :header="t('documents.saveScenarioHeader', 'Save as standard scenario')"
    :style="{ width: '28rem' }"
    :closable="!savingScenario"
  >
    <div class="flex flex-col gap-2">
      <label
        for="doc-scenario-name"
        class="text-sm font-medium"
      >
        {{ t('documents.scenarioName', 'Scenario name') }}
      </label>
      <InputText
        id="doc-scenario-name"
        v-model="scenarioName"
        fluid
        autofocus
        :disabled="savingScenario"
        @keydown.enter.prevent="onConfirmSaveScenario"
      />
      <label
        for="doc-scenario-description"
        class="text-sm font-medium"
      >
        {{ t('documents.scenarioDescription', 'Description') }}
      </label>
      <InputText
        id="doc-scenario-description"
        v-model="scenarioDescription"
        fluid
        :disabled="savingScenario"
      />
      <p class="m-0 text-sm text-muted-color">
        {{
          t(
            'documents.scenarioSaveHint',
            'Saves the current answers for this template. Fields filled from the record are left out, so the scenario can be reused on other records.',
          )
        }}
      </p>
    </div>
    <template #footer>
      <Button
        type="button"
        :label="t('common.cancel', 'Cancel')"
        severity="secondary"
        text
        :disabled="savingScenario"
        @click="saveScenarioVisible = false"
      />
      <Button
        type="button"
        :label="t('common.save', 'Save')"
        icon="pi pi-check"
        :loading="savingScenario"
        @click="onConfirmSaveScenario"
      />
    </template>
  </Dialog>
</template>

<style scoped>
/* PrimeVue Dialog: pin header/footer, let body flex and scroll inside children. */
:deep(.doc-fill-dialog.p-dialog),
:deep(.p-dialog.doc-fill-dialog) {
  display: flex;
  flex-direction: column;
  max-height: 95vh;
}

:deep(.doc-fill-dialog .p-dialog-header),
:deep(.doc-fill-dialog .p-dialog-footer) {
  flex-shrink: 0;
}

:deep(.doc-fill-dialog .p-dialog-content) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

:deep(.doc-editor-host) {
  min-height: 0;
}

:deep(.design-shell--active) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/*
 * Fill mode (no design panels): DocEngine only enables editor scroll under `.page > …`.
 * Helix hosts the editor in a dialog, so mirror that scroll contract here.
 */
:deep(.design-shell:not(.design-shell--active)) {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

:deep(.design-shell:not(.design-shell--active) .design-panel--center) {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

:deep(.design-shell:not(.design-shell--active) .design-panel__editor-scroll) {
  flex: 1 1 0 !important;
  min-height: 0 !important;
  height: auto !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
}

.doc-fill-preview.preview-modal__body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.doc-fill-preview .preview-modal__html {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
