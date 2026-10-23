<script lang="ts">
export default {
  name: 'DocumentBuilderPanel',
}
</script>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import { normalizeFieldMappingSpec } from '@docengine/editor'
import type { FieldMappingSpec } from '@/modules/documents/services/docFieldMapping'
import DocEditorHost from '@/core/ui-kit/DocEditorHost.vue'
import {
  buildRoleSelectOptions,
  loadAppRoles,
  parseSettingRoleId,
  roleIdToSelectValue,
  selectValueToRoleId,
} from '@/core/settingRoleUtils'
import { useTranslation } from '@/core/translation'
import { formatLocalizedDateTime } from '@/core/dateFormatting'
import type { AppRoleOption, DocTemplateRecord, DocTemplateSnapshotRecord } from '@/interfaces'
import {
  normalizeDocTemplateOutputFormat,
  type DocEngineExportMode,
} from '@/interfaces/documents'
import {
  loadDocTemplateById,
  saveDocTemplate,
} from '@/modules/documents/services/docTemplateService'
import {
  listDocTemplateSnapshots,
  loadDocTemplateSnapshotById,
} from '@/modules/documents/services/docTemplateSnapshotService'
import {
  buildDocSourceSamplePayload,
  collectionSupportsItemGroupPriceTreeSample,
  DOC_SOURCE_SAMPLE_MAX_DEPTH,
  fieldMappingToEditorSpec,
  serializeFieldMappingForSave,
} from '@/modules/documents/services/docFieldMapping'
import { buildDocListSourceSamplePayload } from '@/modules/documents/services/docPopulation'

export interface DocumentListSourceContext {
  viewLabel?: string | null
  /** Prebuilt filter block `{ "Date Visit Start": value }`, or pass `filterConditions`. */
  filter?: Record<string, unknown> | null
  filterConditions?: Array<{
    id: string
    field: string
    operator: string
    value: unknown
    type?: string
    userVisible?: boolean
    fieldWidth?: number
  }> | null
  /** Related-list designer: sample uses `meta.parent` instead of `meta.filter`. */
  parentCollection?: string | null
}

const props = withDefaults(
  defineProps<{
    collection: string
    initialLayoutId?: string | null
    createNew?: boolean
    setupMode?: boolean
    /** When true, keep list-shaped `{ records, meta }` sample for Database / Field Mapping. */
    forceListPayloadSample?: boolean
    /** Meta overrides when designing a list Document report from a list view. */
    listSourceContext?: DocumentListSourceContext | null
  }>(),
  {
    initialLayoutId: null,
    createNew: false,
    setupMode: false,
    forceListPayloadSample: false,
    listSourceContext: null,
  },
)

const emit = defineEmits<{
  status: [message: string | null]
  error: [message: string | null]
  saved: [templateId: string]
}>()

const { t } = useTranslation()
const confirm = useConfirm()
const toast = useToast()
const editorRef = ref<InstanceType<typeof DocEditorHost> | null>(null)
const templateName = ref('')
const templateDescription = ref('')
const templateRoleId = ref<string | null>(null)
const templateActive = ref(true)
const attachFile = ref(true)
const outputFormat = ref<DocEngineExportMode>('pdf')
const hideEmpty = ref(false)
const roleOptions = ref<AppRoleOption[]>([])
const roleSelectOptions = computed(() =>
  buildRoleSelectOptions(
    roleOptions.value,
    t('layoutRole.defaultRole', 'Default (all roles)'),
  ),
)
const metaCollapsed = ref(false)
const layoutLoading = ref(false)
const layoutSaving = ref(false)
const mappingOpening = ref(false)
/** Default on so Field Mapping shows `$payload.records[]` for list reports. */
const listPayloadSample = ref(true)
const listPayloadForced = computed(() => props.forceListPayloadSample === true)
/** Virtual `item_group_tree*` at payload root for Tree mode list reports. */
const treePayloadSample = ref(true)
const treePayloadSampleAvailable = ref(false)
const ioBusy = ref(false)
const currentTemplateId = ref<string | null>(null)
const testFillMode = ref(false)
const editorDesignMode = computed(() => !testFillMode.value)
const chromeBusy = computed(
  () => layoutLoading.value || layoutSaving.value || ioBusy.value,
)

const snapshots = ref<DocTemplateSnapshotRecord[]>([])
const selectedSnapshotId = ref<string | null>(null)
const latestSnapshotId = ref<string | null>(null)

const outputFormatOptions = computed(() => [
  { label: t('documents.outputFormatPdf', 'PDF'), value: 'pdf' as const },
  { label: t('documents.outputFormatHtml', 'HTML'), value: 'html' as const },
])

const versionOptions = computed(() =>
  snapshots.value.map((snap, index) => {
    const when = formatLocalizedDateTime(snap.date_created) || ''
    const current =
      latestSnapshotId.value && String(snap.id) === latestSnapshotId.value
        ? t('documents.versionCurrent', 'current')
        : null
    const label = current
      ? t('documents.versionOptionCurrent', 'v{version} ({current}) — {when}', {
          version: snap.version,
          current,
          when,
        })
      : t('documents.versionOption', 'v{version} — {when}', {
          version: snap.version,
          when,
        })
    return {
      label,
      value: String(snap.id),
      isLatest: index === 0,
    }
  }),
)

const importInput = ref<HTMLInputElement | null>(null)

type ImportKind = 'full' | 'template' | 'values'

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'errors' in err) {
    const errors = (err as { errors?: Array<{ message?: string }> }).errors
    const message = errors?.map((entry) => entry.message).filter(Boolean).join(' ')
    if (message) return message
  }
  return err instanceof Error ? err.message : fallback
}

async function waitForEditor(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (editorRef.value) {
      await editorRef.value.whenReady()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(t('documents.editorNotReady', 'Document editor is not ready.'))
}

async function refreshTreePayloadSampleAvailability(): Promise<void> {
  const collection = props.collection?.trim() || ''
  if (!collection) {
    treePayloadSampleAvailable.value = false
    return
  }
  treePayloadSampleAvailable.value =
    await collectionSupportsItemGroupPriceTreeSample(collection)
}

/** Same Source payload Field Mapping uses — so Database tab shows meta/records when checked. */
async function resolveSourceSample(): Promise<Record<string, unknown>> {
  const useListSample = listPayloadForced.value || listPayloadSample.value
  if (!useListSample) {
    return buildDocSourceSamplePayload(props.collection, {
      maxDepth: DOC_SOURCE_SAMPLE_MAX_DEPTH,
    })
  }
  return buildDocListSourceSamplePayload(props.collection, {
    maxDepth: DOC_SOURCE_SAMPLE_MAX_DEPTH,
    viewLabel: props.listSourceContext?.viewLabel,
    filter: props.listSourceContext?.filter,
    filterConditions: props.listSourceContext?.filterConditions,
    parentCollection: props.listSourceContext?.parentCollection,
    includeTreeSample: treePayloadSampleAvailable.value && treePayloadSample.value,
  })
}

async function syncEditorSourceSample(): Promise<void> {
  if (!props.collection) return
  await waitForEditor()
  const current = editorRef.value!.getFieldMapping()
  const sourceSample = await resolveSourceSample()
  editorRef.value!.setFieldMapping(
    normalizeFieldMappingSpec({
      ...(current ?? {}),
      sourceSample,
    } as FieldMappingSpec),
  )
}

async function refreshSnapshots(templateId: string | null): Promise<void> {
  if (!templateId) {
    snapshots.value = []
    selectedSnapshotId.value = null
    latestSnapshotId.value = null
    return
  }
  try {
    const rows = await listDocTemplateSnapshots(templateId)
    snapshots.value = rows
    latestSnapshotId.value = rows[0]?.id ? String(rows[0].id) : null
    if (!selectedSnapshotId.value && latestSnapshotId.value) {
      selectedSnapshotId.value = latestSnapshotId.value
    }
  } catch {
    snapshots.value = []
    latestSnapshotId.value = null
  }
}

async function loadTemplateBody(
  record: Pick<DocTemplateRecord, 'body' | 'field_mapping'>,
): Promise<void> {
  if (!record.body) return

  await nextTick()
  await waitForEditor()
  await editorRef.value!.load(record.body)

  if (record.field_mapping && typeof record.field_mapping === 'object') {
    const spec = await fieldMappingToEditorSpec(
      record.field_mapping,
      props.collection,
      record.body,
    )
    editorRef.value!.setFieldMapping(spec)
  } else {
    editorRef.value!.setFieldMapping(null)
  }
  await syncEditorSourceSample()
}

async function loadTemplate(): Promise<void> {
  if (!props.collection) return

  layoutLoading.value = true
  testFillMode.value = false
  emit('status', null)
  emit('error', null)

  try {
    if (props.createNew || !props.initialLayoutId) {
      currentTemplateId.value = null
      templateName.value = t('documents.newTemplate', 'New template')
      templateDescription.value = ''
      templateRoleId.value = null
      templateActive.value = true
      attachFile.value = true
      outputFormat.value = 'pdf'
      hideEmpty.value = false
      await refreshSnapshots(null)
      await nextTick()
      await waitForEditor()
      await editorRef.value!.load({
        kind: 'document',
        time: Date.now(),
        blocks: [],
      })
      editorRef.value!.setFieldMapping(null)
      await syncEditorSourceSample()
      return
    }

    const record = await loadDocTemplateById(props.initialLayoutId)
    if (!record) {
      throw new Error(t('documents.templateNotFound', 'Document template not found.'))
    }

    currentTemplateId.value = String(record.id)
    templateName.value = record.name
    templateDescription.value = record.description ?? ''
    templateRoleId.value = parseSettingRoleId(record.role)
    templateActive.value = record.is_active !== false
    attachFile.value = record.attach_file !== false
    outputFormat.value = normalizeDocTemplateOutputFormat(record.output_format)
    hideEmpty.value = record.hide_empty === true
    await loadTemplateBody(record)
    await refreshSnapshots(currentTemplateId.value)
  } catch (err) {
    const message = apiErrorMessage(
      err,
      t('documents.loadTemplateError', 'Failed to load document template.'),
    )
    emit('error', message)
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: message,
      life: 6000,
    })
  } finally {
    layoutLoading.value = false
  }
}

async function onVersionSelected(snapshotId: string | null): Promise<void> {
  selectedSnapshotId.value = snapshotId
  if (!snapshotId) return
  if (latestSnapshotId.value && snapshotId === latestSnapshotId.value) {
    // Current head already loaded from doc_template on open; reload head for safety.
    if (currentTemplateId.value) {
      const record = await loadDocTemplateById(currentTemplateId.value)
      if (record) await loadTemplateBody(record)
    }
    return
  }
  try {
    ioBusy.value = true
    const snap = await loadDocTemplateSnapshotById(snapshotId)
    if (!snap?.body) {
      throw new Error(t('documents.snapshotNotFound', 'Template version not found.'))
    }
    await loadTemplateBody({
      body: snap.body,
      field_mapping: snap.field_mapping ?? null,
    })
    toast.add({
      severity: 'info',
      summary: t('documents.versionLoaded', 'Version loaded'),
      detail: t(
        'documents.versionLoadedDetail',
        'Editing an older snapshot. Save creates a new version from this content.',
      ),
      life: 4000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: apiErrorMessage(err, t('documents.snapshotNotFound', 'Template version not found.')),
      life: 5000,
    })
  } finally {
    ioBusy.value = false
  }
}

async function saveLayout(): Promise<void> {
  if (!props.collection) {
    const message = t('documents.collectionRequired', 'Collection is required.')
    emit('error', message)
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: message,
      life: 5000,
    })
    return
  }

  const name = templateName.value.trim()
  if (!name) {
    const message = t('documents.templateNameRequired', 'Template name is required.')
    emit('error', message)
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: message,
      life: 4000,
    })
    return
  }

  if (testFillMode.value) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t(
        'documents.exitTestFillModeToSave',
        'Switch off test fill mode before saving the template.',
      ),
      life: 4000,
    })
    return
  }

  layoutSaving.value = true
  emit('status', null)
  emit('error', null)

  try {
    await waitForEditor()
    const exportedTemplate = await editorRef.value!.exportTemplate()
    if (!exportedTemplate) {
      throw new Error(t('documents.exportTemplateError', 'Failed to export template.'))
    }

    const fieldMapping = serializeFieldMappingForSave(editorRef.value!.getFieldMapping())
    if (fieldMapping) {
      exportedTemplate.fieldMapping = fieldMapping
    } else {
      delete exportedTemplate.fieldMapping
    }

    const saved = await saveDocTemplate(
      {
        name,
        description: templateDescription.value,
        collection: props.collection,
        body: exportedTemplate,
        field_mapping: fieldMapping,
        roleId: templateRoleId.value,
        isActive: templateActive.value,
        attachFile: attachFile.value,
        outputFormat: outputFormat.value,
        hideEmpty: hideEmpty.value,
      },
      currentTemplateId.value,
    )

    if (!saved?.id) {
      throw new Error(t('documents.saveTemplateError', 'Failed to save document template.'))
    }

    currentTemplateId.value = String(saved.id)

    const savedName = String(saved.name ?? '').trim()
    if (savedName && savedName !== name) {
      templateName.value = savedName
      await refreshSnapshots(currentTemplateId.value)
      selectedSnapshotId.value = latestSnapshotId.value
      emit('saved', currentTemplateId.value)
      toast.add({
        severity: 'warn',
        summary: t('common.warning', 'Warning'),
        detail: t(
          'documents.templateNameNotSaved',
          'Template content was saved, but the name could not be changed (field may be auto-numbered or read-only).',
        ),
        life: 6000,
      })
      return
    }
    templateName.value = savedName || name

    await refreshSnapshots(currentTemplateId.value)
    selectedSnapshotId.value = latestSnapshotId.value
    emit('saved', currentTemplateId.value)
    toast.add({
      severity: 'success',
      summary: t('common.saved', 'Saved'),
      detail: t('documents.templateSaved', 'Document template saved.'),
      life: 3000,
    })
  } catch (err) {
    const message = apiErrorMessage(
      err,
      t('documents.saveTemplateError', 'Failed to save document template.'),
    )
    emit('error', message)
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: message,
      life: 6000,
    })
  } finally {
    layoutSaving.value = false
  }
}

async function openFieldMappingEditor(): Promise<void> {
  if (!props.collection) {
    const message = t('documents.collectionRequired', 'Collection is required.')
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: message,
      life: 4000,
    })
    return
  }

  mappingOpening.value = true
  emit('error', null)

  try {
    await waitForEditor()
    const current = editorRef.value!.getFieldMapping()
    const sourceSample = await resolveSourceSample()
    const spec = normalizeFieldMappingSpec({
      ...(current ?? {}),
      sourceSample,
    } as FieldMappingSpec)

    await editorRef.value!.openFieldMapping({ spec })
  } catch (err) {
    const message = apiErrorMessage(
      err,
      t('documents.openFieldMappingError', 'Failed to open field mapping editor.'),
    )
    emit('error', message)
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: message,
      life: 6000,
    })
  } finally {
    mappingOpening.value = false
  }
}

function fileBase(): string {
  const raw = templateName.value.trim() || 'document-template'
  return raw.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').slice(0, 80)
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function exportFullDocument(): Promise<void> {
  try {
    ioBusy.value = true
    await waitForEditor()
    const data = await editorRef.value!.exportDoc()
    if (!data) throw new Error(t('documents.exportDocumentError', 'Failed to export document.'))
    downloadJson(data, `${fileBase()}-full-document.json`)
    toast.add({
      severity: 'success',
      summary: t('documents.exported', 'Exported'),
      detail: t('documents.exportedFullDocument', 'Full document downloaded.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: apiErrorMessage(err, t('documents.exportDocumentError', 'Failed to export document.')),
      life: 5000,
    })
  } finally {
    ioBusy.value = false
  }
}

async function exportTemplateJson(): Promise<void> {
  try {
    ioBusy.value = true
    await waitForEditor()
    const data = await editorRef.value!.exportTemplate()
    const mapping = editorRef.value!.getFieldMapping()
    if (mapping) data.fieldMapping = mapping
    else delete data.fieldMapping
    downloadJson(data, `${fileBase()}-template.json`)
    toast.add({
      severity: 'success',
      summary: t('documents.exported', 'Exported'),
      detail: t('documents.exportedTemplate', 'Template downloaded.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: apiErrorMessage(err, t('documents.exportTemplateError', 'Failed to export template.')),
      life: 5000,
    })
  } finally {
    ioBusy.value = false
  }
}

async function exportValuesJson(): Promise<void> {
  try {
    ioBusy.value = true
    await waitForEditor()
    const data = await editorRef.value!.exportFields()
    if (!data) throw new Error(t('documents.exportValuesError', 'Failed to export document values.'))
    downloadJson(data, `${fileBase()}-values.json`)
    toast.add({
      severity: 'success',
      summary: t('documents.exported', 'Exported'),
      detail: t('documents.exportedValues', 'Values downloaded.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: apiErrorMessage(err, t('documents.exportValuesError', 'Failed to export document values.')),
      life: 5000,
    })
  } finally {
    ioBusy.value = false
  }
}

function detectImportKind(data: Record<string, unknown>): ImportKind {
  const kind = data.kind
  if (kind === 'template') return 'template'
  if (kind === 'field') return 'values'
  if (kind === 'document') {
    if (!Array.isArray(data.blocks) && (data.values || data.sections)) return 'values'
    return 'full'
  }
  if (Array.isArray(data.blocks)) {
    return data.fieldSchemas || data.time || data.pageSetup ? 'full' : 'template'
  }
  if (data.values || data.sections) return 'values'
  if (data.fieldSchemas) return 'template'
  throw new Error(
    t(
      'documents.importUnrecognized',
      'Unrecognized JSON. Expected a DocEngine export (document, template, or values).',
    ),
  )
}

function confirmTemplateImport(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    confirm.require({
      header: t('documents.importTemplateHeader', 'Import template'),
      message: t(
        'documents.importTemplateConfirm',
        'Load template? Current layout and field schemas will be replaced.',
      ),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: t('common.ok', 'OK'),
      rejectLabel: t('common.cancel', 'Cancel'),
      accept: () => finish(true),
      reject: () => finish(false),
      onHide: () => finish(false),
    })
  })
}

function openImport(): void {
  importInput.value?.click()
}

async function previewDocument(): Promise<void> {
  try {
    ioBusy.value = true
    await waitForEditor()
    await editorRef.value!.preview({ hideEmptyValues: hideEmpty.value })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: apiErrorMessage(err, t('documents.previewError', 'Failed to open preview.')),
      life: 5000,
    })
  } finally {
    ioBusy.value = false
  }
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    ioBusy.value = true
    await waitForEditor()
    const parsed = JSON.parse(await file.text()) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(t('documents.importInvalidJson', 'File is not valid JSON.'))
    }

    const kind = detectImportKind(parsed)

    if (kind === 'template') {
      const confirmed = await confirmTemplateImport()
      if (!confirmed) return
      await editorRef.value!.load(parsed)
      if (parsed.fieldMapping && typeof parsed.fieldMapping === 'object') {
        const spec = await fieldMappingToEditorSpec(
          parsed.fieldMapping as Record<string, unknown>,
          props.collection,
          parsed,
        )
        editorRef.value!.setFieldMapping(spec)
      }
      await syncEditorSourceSample()
      toast.add({
        severity: 'success',
        summary: t('documents.imported', 'Imported'),
        detail: t('documents.importedTemplate', 'Template loaded into the editor.'),
        life: 3000,
      })
      return
    }

    if (kind === 'values') {
      await editorRef.value!.load(parsed)
      toast.add({
        severity: 'success',
        summary: t('documents.imported', 'Imported'),
        detail: t('documents.importedValues', 'Values loaded into the editor.'),
        life: 3000,
      })
      return
    }

    await editorRef.value!.load(parsed)
    toast.add({
      severity: 'success',
      summary: t('documents.imported', 'Imported'),
      detail: t('documents.importedFullDocument', 'Full document loaded into the editor.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: apiErrorMessage(err, t('documents.importFailed', 'Import failed.')),
      life: 5000,
    })
  } finally {
    ioBusy.value = false
  }
}

watch(
  () => [props.collection, props.initialLayoutId, props.createNew] as const,
  () => {
    void loadTemplate()
  },
  { immediate: true },
)

watch(
  () => props.forceListPayloadSample,
  (forced) => {
    if (forced) listPayloadSample.value = true
  },
  { immediate: true },
)

watch(
  [
    listPayloadSample,
    treePayloadSample,
    () => props.listSourceContext?.viewLabel,
    () => props.listSourceContext?.filter,
    () => props.listSourceContext?.filterConditions,
    () => props.listSourceContext?.parentCollection,
  ],
  () => {
    void syncEditorSourceSample().catch(() => {
      // Editor may not be ready yet during first paint; loadTemplate will sync.
    })
  },
)

watch(
  () => props.collection,
  () => {
    void refreshTreePayloadSampleAvailability()
  },
  { immediate: true },
)

onMounted(async () => {
  roleOptions.value = await loadAppRoles()
})

defineExpose({
  saveLayout,
})
</script>

<template>
  <div class="document-builder flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <div
      class="document-builder__meta shrink-0"
      :class="{ 'document-builder__meta--collapsed': metaCollapsed }"
    >
      <div class="document-builder__meta-bar">
        <Button
          type="button"
          class="document-builder__meta-toggle"
          :icon="metaCollapsed ? 'pi pi-chevron-down' : 'pi pi-chevron-up'"
          text
          rounded
          size="small"
          severity="secondary"
          :aria-expanded="!metaCollapsed"
          :aria-label="metaCollapsed
            ? t('documents.expandTopPanel', 'Expand top panel')
            : t('documents.collapseTopPanel', 'Collapse top panel')"
          :title="metaCollapsed
            ? t('documents.expandTopPanel', 'Expand top panel')
            : t('documents.collapseTopPanel', 'Collapse top panel')"
          @click="metaCollapsed = !metaCollapsed"
        />
        <template v-if="metaCollapsed">
          <span class="document-builder__meta-title" :title="templateName || undefined">
            {{ templateName || t('documents.newTemplate', 'New template') }}
          </span>
          <div
            class="document-builder__switch document-builder__meta-fill"
            :title="testFillMode
              ? t('documents.fillModeHint', 'Filling mode — enter values to test the template.')
              : t('documents.designModeHint', 'Design mode — place fields, then map CRM fields if needed.')"
          >
            <ToggleSwitch
              v-model="testFillMode"
              input-id="doc-template-filling-mode-collapsed"
              :disabled="chromeBusy"
            />
            <label for="doc-template-filling-mode-collapsed">
              {{ t('documents.testFillMode', 'Filling mode') }}
            </label>
          </div>
          <Button
            type="button"
            :label="t('documents.preview', 'Preview')"
            icon="pi pi-eye"
            size="small"
            severity="secondary"
            outlined
            :disabled="chromeBusy"
            @click="previewDocument"
          />
          <Button
            type="button"
            class="document-builder__save"
            :label="t('documents.saveTemplate', 'Save Template')"
            icon="pi pi-save"
            size="small"
            :loading="layoutSaving"
            :disabled="chromeBusy"
            @click="saveLayout"
          />
        </template>
      </div>

      <template v-if="!metaCollapsed">
        <div class="document-builder__identity">
          <div class="document-builder__field">
            <label class="document-builder__label" for="doc-template-name">
              {{ t('documents.templateName', 'Template name') }}
              <span class="document-builder__required" aria-hidden="true">*</span>
            </label>
            <InputText
              id="doc-template-name"
              v-model="templateName"
              fluid
              required
            />
          </div>
          <div class="document-builder__field">
            <label class="document-builder__label" for="doc-template-description">
              {{ t('documents.templateDescription', 'Description') }}
            </label>
            <InputText
              id="doc-template-description"
              v-model="templateDescription"
              fluid
              :placeholder="t('documents.templateDescriptionPlaceholder', 'Optional layout description...')"
            />
          </div>
          <div class="document-builder__field">
            <label class="document-builder__label" for="doc-template-collection">
              {{ t('documents.sourceObject', 'Source object') }}
            </label>
            <InputText
              id="doc-template-collection"
              :model-value="collection"
              fluid
              readonly
              disabled
            />
          </div>
          <div class="document-builder__field">
            <label class="document-builder__label" for="doc-template-role">
              {{ t('layoutRole.role', 'Role') }}
            </label>
            <Select
              id="doc-template-role"
              :model-value="roleIdToSelectValue(templateRoleId)"
              :options="roleSelectOptions"
              option-label="label"
              option-value="value"
              fluid
              @update:model-value="templateRoleId = selectValueToRoleId($event)"
            />
          </div>
        </div>

        <div class="document-builder__controls">
          <div
            class="document-builder__switch"
            :title="t('documents.attachFileHint', 'When on, finishing a filled document attaches an export file to the record.')"
          >
            <ToggleSwitch
              v-model="attachFile"
              input-id="doc-template-attach-file"
              :disabled="chromeBusy"
            />
            <label for="doc-template-attach-file">{{ t('documents.attachFile', 'Attach file') }}</label>
          </div>

          <div class="document-builder__inline">
            <label class="document-builder__label document-builder__label--inline" for="doc-template-output">
              {{ t('documents.outputFormat', 'Output format') }}:
            </label>
            <Select
              id="doc-template-output"
              v-model="outputFormat"
              :options="outputFormatOptions"
              option-label="label"
              option-value="value"
              size="small"
              class="document-builder__select-sm"
              :disabled="chromeBusy || !attachFile"
            />
          </div>

          <div class="document-builder__switch">
            <ToggleSwitch
              v-model="templateActive"
              input-id="doc-template-active"
              :disabled="chromeBusy"
            />
            <label for="doc-template-active">{{ t('documents.templateActive', 'Active') }}</label>
          </div>

          <div
            class="document-builder__switch"
            :title="t('documents.hideEmptyHint', 'When on, preview and export omit empty field values.')"
          >
            <ToggleSwitch
              v-model="hideEmpty"
              input-id="doc-template-hide-empty"
              :disabled="chromeBusy"
            />
            <label for="doc-template-hide-empty">{{ t('documents.hideEmpty', 'Hide empty fields') }}</label>
          </div>

          <div class="document-builder__version">
            <i class="pi pi-clock" aria-hidden="true" />
            <label class="document-builder__label document-builder__label--inline" for="doc-template-version">
              {{ t('documents.versionLabel', 'Version') }}:
            </label>
            <Select
              id="doc-template-version"
              :model-value="selectedSnapshotId"
              :options="versionOptions"
              option-label="label"
              option-value="value"
              size="small"
              class="document-builder__version-select"
              :placeholder="t('documents.noVersion', '—')"
              :disabled="chromeBusy || versionOptions.length === 0"
              @update:model-value="onVersionSelected(($event as string) || null)"
            />
          </div>
        </div>

        <div class="document-builder__actions">
          <div
            class="document-builder__switch"
            :title="testFillMode
              ? t('documents.fillModeHint', 'Filling mode — enter values to test the template.')
              : t('documents.designModeHint', 'Design mode — place fields, then map CRM fields if needed.')"
          >
            <ToggleSwitch
              v-model="testFillMode"
              input-id="doc-template-filling-mode"
              :disabled="chromeBusy"
            />
            <label for="doc-template-filling-mode">{{ t('documents.testFillMode', 'Filling mode') }}</label>
          </div>

          <Button
            type="button"
            :label="t('documents.preview', 'Preview')"
            icon="pi pi-eye"
            size="small"
            severity="secondary"
            outlined
            :disabled="chromeBusy"
            @click="previewDocument"
          />

          <ButtonGroup>
            <Button
              type="button"
              :label="t('documents.ioTemplate', 'Template')"
              icon="pi pi-download"
              size="small"
              severity="secondary"
              outlined
              :title="t('documents.ioTemplateHint', 'Template JSON (structure only)')"
              :disabled="chromeBusy"
              @click="exportTemplateJson"
            />
            <Button
              type="button"
              :label="t('documents.ioValues', 'Values')"
              icon="pi pi-file"
              size="small"
              severity="secondary"
              outlined
              :title="t('documents.ioValuesHint', 'Field values JSON')"
              :disabled="chromeBusy"
              @click="exportValuesJson"
            />
            <Button
              type="button"
              :label="t('documents.ioFullDocument', 'Full document')"
              icon="pi pi-download"
              size="small"
              severity="secondary"
              outlined
              :title="t('documents.ioFullDocumentHint', 'Full document JSON (structure + values)')"
              :disabled="chromeBusy"
              @click="exportFullDocument"
            />
            <Button
              type="button"
              :label="t('documents.fieldMapping', 'Field Mapping')"
              icon="pi pi-arrow-right-arrow-left"
              size="small"
              severity="secondary"
              outlined
              :loading="mappingOpening"
              :disabled="chromeBusy || mappingOpening || testFillMode"
              @click="openFieldMappingEditor"
            />
          </ButtonGroup>

          <label
            class="flex items-center gap-2 text-[0.8rem] text-surface-700 cursor-pointer whitespace-nowrap"
            :title="
              props.listSourceContext?.parentCollection
                ? t(
                    'documents.listPayloadSampleRelatedHint',
                    'Related list sample uses { records, meta.parent }. Map parent fields to $payload.meta.parent.*',
                  )
                : t(
                    'documents.listPayloadSampleHint',
                    'Use { records, meta } sample so Field Mapping can bind table columns to $payload.records.*',
                  )
            "
          >
            <Checkbox
              v-model="listPayloadSample"
              binary
              :disabled="chromeBusy || testFillMode || listPayloadForced"
            />
            <span>{{ t('documents.listPayloadSample', 'List payload sample') }}</span>
          </label>

          <label
            v-if="treePayloadSampleAvailable && (listPayloadForced || listPayloadSample)"
            class="flex items-center gap-2 text-[0.8rem] text-surface-700 cursor-pointer whitespace-nowrap"
            :title="
              t(
                'documents.treePayloadSampleHint',
                'Add virtual item_group_tree / item_group_tree_rows / item_group_tree_sections for Tree mode list reports. Map group headers and nested prices from $payload.item_group_tree*.',
              )
            "
          >
            <Checkbox
              v-model="treePayloadSample"
              binary
              :disabled="chromeBusy || testFillMode"
            />
            <span>{{ t('documents.treePayloadSample', 'Tree sample') }}</span>
          </label>

          <Button
            type="button"
            :label="t('documents.importJson', 'Import')"
            icon="pi pi-upload"
            size="small"
            severity="secondary"
            outlined
            :title="t('documents.importJsonHint', 'Import JSON — detects document, template, or values')"
            :disabled="chromeBusy"
            @click="openImport"
          />
          <input
            ref="importInput"
            type="file"
            accept="application/json,.json"
            class="hidden"
            @change="onImportFile"
          >

          <Button
            type="button"
            class="document-builder__save"
            :label="t('documents.saveTemplate', 'Save Template')"
            icon="pi pi-save"
            size="small"
            :loading="layoutSaving"
            :disabled="chromeBusy"
            @click="saveLayout"
          />
        </div>
      </template>
    </div>

    <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        v-if="layoutLoading"
        class="page-loading absolute inset-0 z-10 bg-surface-0/80"
      >
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('documents.loadingEditor', 'Loading document editor...') }}</span>
      </div>

      <DocEditorHost
        ref="editorRef"
        :design-mode="editorDesignMode"
        :show-document-actions="false"
        :collection="collection"
        class="flex-1"
      />
    </div>
  </div>
</template>

<style scoped>
.document-builder__meta {
  background: var(--p-surface-50);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  padding: 1rem;
}

.document-builder__meta--collapsed {
  padding: 0.5rem 0.75rem;
}

.document-builder__meta-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.document-builder__meta:not(.document-builder__meta--collapsed) .document-builder__meta-bar {
  margin-bottom: 0.75rem;
}

.document-builder__meta-toggle {
  flex-shrink: 0;
}

.document-builder__meta-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.document-builder__meta-fill {
  margin-left: auto;
  flex-shrink: 0;
}

.document-builder__meta--collapsed .document-builder__save {
  margin-left: 0;
}

.document-builder__identity {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
}

.document-builder__field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.document-builder__label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.document-builder__label--inline {
  white-space: nowrap;
}

.document-builder__required {
  margin-left: 0.15rem;
  color: var(--p-red-500, #ef4444);
}

.document-builder__controls,
.document-builder__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  border-top: 1px solid var(--p-content-border-color);
  margin-top: 1rem;
  padding-top: 1rem;
}

.document-builder__actions {
  gap: 0.75rem;
}

.document-builder__inline,
.document-builder__switch,
.document-builder__version {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.document-builder__switch {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--p-text-muted-color);
}

.document-builder__switch label {
  cursor: pointer;
}

.document-builder__version {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.document-builder__select-sm {
  width: 6.5rem;
}

.document-builder__version-select {
  width: 16rem;
  max-width: 100%;
}

.document-builder__save {
  margin-left: auto;
}

@media (max-width: 64rem) {
  .document-builder__identity {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 40rem) {
  .document-builder__identity {
    grid-template-columns: 1fr;
  }

  .document-builder__save {
    margin-left: 0;
  }
}

.document-builder :deep(.design-shell--active) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  align-self: stretch;
}

.document-builder :deep(.design-shell--active > .design-panel--left) {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.document-builder :deep(.design-shell--active > .design-panel--left .field-palette--vertical) {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  align-self: stretch;
}

.document-builder :deep(.design-shell--active > .design-panel--left .field-palette__body) {
  flex: 1 1 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.document-builder :deep(.design-shell--active > .design-panel--left .field-palette__group),
.document-builder :deep(.design-shell--active > .design-panel--left .field-palette__item) {
  flex-shrink: 0;
}

.document-builder :deep(.design-shell--active > .design-panel--left .field-palette--vertical .field-palette__group) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
</style>
