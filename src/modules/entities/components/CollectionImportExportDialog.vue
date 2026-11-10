<script lang="ts">
export default {
  name: 'CollectionImportExportDialog',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import {
  canCreateEntity,
  canExportEntity,
  canImportEntity,
  canReadEntity,
  canUpdateEntity,
} from '@/core/entityPermissions'
import type { ParsedCsv } from '@/core/csv'
import {
  COLLECTION_CSV_MAX_ROWS,
  autoMapColumns,
  buildImportPreview,
  buildPreviewImportLog,
  downloadImportLog,
  expandPreferredExportFields,
  exportCollectionCsv,
  listExportableFields,
  listImportMappingTargets,
  listImportableFields,
  parseCsvFileText,
  resolveDefaultMatchFields,
  runImport,
  type ColumnMapping,
  type ExportableField,
  type ImportLogEntry,
  type ImportMappingTarget,
  type ImportMode,
  type ImportPreviewResult,
  type ImportRunResult,
  type ImportableField,
} from '../services/collectionImportExport'

type FlowMode = 'choose' | 'export' | 'import'
type ImportStep = 'upload' | 'map' | 'options' | 'preview' | 'result'

const props = withDefaults(
  defineProps<{
    visible: boolean
    collection: string
    listFilter?: Record<string, unknown> | null
    listSearch?: string | null
    /** Preferred export field api names (e.g. current list columns). */
    preferredFields?: string[] | null
  }>(),
  {
    listFilter: null,
    listSearch: null,
    preferredFields: null,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  imported: []
}>()

const { t } = useTranslation()
const toast = useToast()

const flow = ref<FlowMode>('choose')
const importStep = ref<ImportStep>('upload')
const busy = ref(false)
const progressDone = ref(0)
const progressTotal = ref(0)

const fields = ref<ImportableField[]>([])
const mappingTargets = ref<ImportMappingTarget[]>([])
const exportFields = ref<ExportableField[]>([])
const exportFieldKeys = ref<string[]>([])
const parsed = ref<ParsedCsv | null>(null)
const fileName = ref('')
const mappings = ref<ColumnMapping[]>([])
const importMode = ref<ImportMode>('upsert')
const matchFields = ref<string[]>([])
const preview = ref<ImportPreviewResult | null>(null)
const runResult = ref<ImportRunResult | null>(null)

const canExport = computed(
  () => canExportEntity(props.collection) && canReadEntity(props.collection),
)
const canImportCreate = computed(() => canCreateEntity(props.collection))
const canImportUpdate = computed(() => canUpdateEntity(props.collection))
const canImport = computed(
  () =>
    canImportEntity(props.collection) &&
    (canImportCreate.value || canImportUpdate.value),
)

const importModeOptions = computed(() => {
  const options: Array<{ label: string; value: ImportMode }> = []
  if (canImportCreate.value) {
    options.push({
      label: t('objectList.importExport.modeCreate', 'Create'),
      value: 'create',
    })
  }
  if (canImportUpdate.value) {
    options.push({
      label: t('objectList.importExport.modeUpdate', 'Update'),
      value: 'update',
    })
  }
  if (canImportCreate.value && canImportUpdate.value) {
    options.push({
      label: t('objectList.importExport.modeUpsert', 'Upsert'),
      value: 'upsert',
    })
  }
  return options
})

const matchFieldOptions = computed(() =>
  fields.value.map((field) => ({
    label: field.isM2O
      ? t(
          'objectList.importExport.matchFieldLookup',
          '{label} ({field}) — resolved id after lookup',
          { label: field.label, field: field.field },
        )
      : `${field.label} (${field.field})`,
    value: field.field,
  })),
)

/** Local fields written by the current column map (lookups resolve into these FKs). */
function matchFieldsFromMappings(): string[] {
  const byValue = new Map(mappingTargets.value.map((target) => [target.value, target]))
  const selected: string[] = []
  for (const mapping of mappings.value) {
    if (!mapping.field) continue
    const target = byValue.get(mapping.field)
    if (!target) continue
    if (!selected.includes(target.targetField)) {
      selected.push(target.targetField)
    }
  }
  return selected.filter((field) => fields.value.some((item) => item.field === field))
}

const fieldSelectOptions = computed(() => [
  {
    label: t('objectList.importExport.skipColumn', 'Skip'),
    value: null as string | null,
  },
  ...mappingTargets.value.map((target) => ({
    label: target.label,
    value: target.value as string | null,
  })),
])

const exportFieldOptions = computed(() =>
  exportFields.value.map((field) => ({
    label: `${field.label} (${field.field})`,
    value: field.field,
  })),
)

const dialogHeader = computed(() => {
  if (flow.value === 'export') {
    return t('objectList.importExport.exportHeader', 'Export CSV')
  }
  if (flow.value === 'import') {
    return t('objectList.importExport.importHeader', 'Import CSV')
  }
  return t('objectList.importExport.title', 'Import / Export')
})

const stepLabel = computed(() => {
  if (flow.value !== 'import') return ''
  const labels: Record<ImportStep, string> = {
    upload: t('objectList.importExport.stepUpload', '1. Upload'),
    map: t('objectList.importExport.stepMap', '2. Map columns'),
    options: t('objectList.importExport.stepOptions', '3. Options'),
    preview: t('objectList.importExport.stepPreview', '4. Preview'),
    result: t('objectList.importExport.stepResult', '5. Result'),
  }
  return labels[importStep.value]
})

const mappedCount = computed(
  () => mappings.value.filter((item) => Boolean(item.field)).length,
)

const previewLogRows = computed(() =>
  preview.value ? buildPreviewImportLog(preview.value.plans) : [],
)
const resultLogRows = computed(() => runResult.value?.log ?? [])

function logStatusLabel(status: ImportLogEntry['status']): string {
  if (status === 'created') {
    return t('objectList.importExport.actionCreate', 'Create')
  }
  if (status === 'updated') {
    return t('objectList.importExport.actionUpdate', 'Update')
  }
  if (status === 'failed') {
    return t('objectList.importExport.actionFailed', 'Failed')
  }
  return t('objectList.importExport.actionSkip', 'Skip')
}

function downloadResultLog(): void {
  if (!resultLogRows.value.length) return
  downloadImportLog(
    resultLogRows.value,
    `${props.collection}-import-log.csv`,
  )
}

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return
    resetState()
    await loadFields()
  },
)

function resetState(): void {
  flow.value = 'choose'
  importStep.value = 'upload'
  busy.value = false
  progressDone.value = 0
  progressTotal.value = 0
  exportFieldKeys.value = []
  parsed.value = null
  fileName.value = ''
  mappings.value = []
  importMode.value = 'upsert'
  matchFields.value = []
  preview.value = null
  runResult.value = null
}

async function loadFields(): Promise<void> {
  if (!props.collection) {
    fields.value = []
    mappingTargets.value = []
    exportFields.value = []
    return
  }
  busy.value = true
  try {
    const [importable, targets, exportable] = await Promise.all([
      listImportableFields(props.collection),
      listImportMappingTargets(props.collection),
      listExportableFields(props.collection),
    ])
    fields.value = importable
    mappingTargets.value = targets
    exportFields.value = exportable
    exportFieldKeys.value = await expandPreferredExportFields(
      props.collection,
      props.preferredFields,
      exportable,
    )
    matchFields.value = await resolveDefaultMatchFields(props.collection)
    if (!canImportCreate.value && canImportUpdate.value) {
      importMode.value = 'update'
    } else if (canImportCreate.value && !canImportUpdate.value) {
      importMode.value = 'create'
    } else {
      importMode.value = 'upsert'
    }
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('objectList.importExport.loadFieldsError', 'Failed to load fields.'),
      life: 5000,
    })
  } finally {
    busy.value = false
  }
}

function close(): void {
  emit('update:visible', false)
}

function startExport(): void {
  if (!canExport.value) return
  flow.value = 'export'
}

function startImport(): void {
  if (!canImport.value) return
  flow.value = 'import'
  importStep.value = 'upload'
}

function backToChoose(): void {
  flow.value = 'choose'
  importStep.value = 'upload'
  parsed.value = null
  fileName.value = ''
  mappings.value = []
  preview.value = null
  runResult.value = null
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  busy.value = true
  try {
    const text = await file.text()
    const next = parseCsvFileText(text)
    if (next.headers.length === 0) {
      throw new Error(
        t('objectList.importExport.emptyCsv', 'CSV file has no header row.'),
      )
    }
    parsed.value = next
    fileName.value = file.name
    mappings.value = autoMapColumns(next.headers, mappingTargets.value)
    importStep.value = 'map'
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('objectList.importExport.parseError', 'Failed to parse CSV.'),
      life: 5000,
    })
  } finally {
    busy.value = false
  }
}

function goImportOptions(): void {
  if (mappedCount.value === 0) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t(
        'objectList.importExport.needMapping',
        'Map at least one column to a field.',
      ),
      life: 4000,
    })
    return
  }
  // Prefer match keys from the column map (e.g. item.description → match on item).
  const fromMap = matchFieldsFromMappings()
  const m2oFromMap = fromMap.filter((field) =>
    fields.value.some((item) => item.field === field && item.isM2O),
  )
  if (m2oFromMap.length > 0) {
    matchFields.value = m2oFromMap
  } else if (fromMap.length > 0 && matchFields.value.length === 0) {
    matchFields.value = fromMap
  }
  importStep.value = 'options'
}

async function runDryPreview(): Promise<void> {
  if (!parsed.value) return
  if (
    (importMode.value === 'update' || importMode.value === 'upsert') &&
    matchFields.value.length === 0
  ) {
    toast.add({
      severity: 'warn',
      summary: t('common.warning', 'Warning'),
      detail: t(
        'objectList.importExport.needMatchFields',
        'Select at least one match field for update/upsert.',
      ),
      life: 4000,
    })
    return
  }

  busy.value = true
  preview.value = null
  try {
    preview.value = await buildImportPreview({
      collection: props.collection,
      parsed: parsed.value,
      mappings: mappings.value,
      mode: importMode.value,
      matchFields: matchFields.value,
    })
    importStep.value = 'preview'
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('objectList.importExport.previewError', 'Failed to preview import.'),
      life: 5000,
    })
  } finally {
    busy.value = false
  }
}

async function commitImport(): Promise<void> {
  if (!preview.value) return
  // Always run: good rows import, bad rows are logged and skipped.
  busy.value = true
  progressDone.value = 0
  progressTotal.value = Math.max(
    preview.value.plans.filter((p) => p.action !== 'skip').length,
    1,
  )
  runResult.value = null
  try {
    runResult.value = await runImport({
      collection: props.collection,
      plans: preview.value.plans,
      onProgress: (done, total) => {
        progressDone.value = done
        progressTotal.value = Math.max(total, 1)
      },
    })
    importStep.value = 'result'
    if (runResult.value.created > 0 || runResult.value.updated > 0) {
      emit('imported')
    }
    // Always generate the detailed CSV log after the import run.
    if (runResult.value.log.length > 0) {
      downloadImportLog(
        runResult.value.log,
        `${props.collection}-import-log.csv`,
      )
    }
    const partial =
      runResult.value.failed > 0 ||
      runResult.value.skipped > 0
    toast.add({
      severity:
        runResult.value.created === 0 &&
        runResult.value.updated === 0 &&
        (runResult.value.failed > 0 || runResult.value.skipped > 0)
          ? 'warn'
          : partial
            ? 'warn'
            : 'success',
      summary: t('objectList.importExport.importDone', 'Import finished'),
      detail: t(
        'objectList.importExport.importDoneDetail',
        'Created {created}, updated {updated}, skipped {skipped}, failed {failed}. Import log downloaded.',
        {
          created: runResult.value.created,
          updated: runResult.value.updated,
          skipped: runResult.value.skipped,
          failed: runResult.value.failed,
        },
      ),
      life: 6000,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('objectList.importExport.importError', 'Import failed.'),
      life: 5000,
    })
  } finally {
    busy.value = false
  }
}

async function doExport(): Promise<void> {
  if (!canExport.value) return
  busy.value = true
  try {
    const result = await exportCollectionCsv({
      collection: props.collection,
      filter: props.listFilter ?? null,
      search: props.listSearch ?? null,
      fields: exportFieldKeys.value,
      limit: COLLECTION_CSV_MAX_ROWS,
      filename: `${props.collection}-export.csv`,
    })
    toast.add({
      severity: 'success',
      summary: t('objectList.importExport.exportDone', 'Exported'),
      detail: t(
        'objectList.importExport.exportDoneDetail',
        'Downloaded {count} of {total} records.',
        { count: result.rowCount, total: result.totalCount },
      ),
      life: 4000,
    })
    close()
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        error instanceof Error
          ? error.message
          : t('objectList.importExport.exportError', 'Export failed.'),
      life: 5000,
    })
  } finally {
    busy.value = false
  }
}

function backImportStep(): void {
  if (importStep.value === 'map') {
    importStep.value = 'upload'
    return
  }
  if (importStep.value === 'options') {
    importStep.value = 'map'
    return
  }
  if (importStep.value === 'preview') {
    importStep.value = 'options'
    return
  }
  if (importStep.value === 'result') {
    importStep.value = 'preview'
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="dialogHeader"
    :style="{ width: 'min(44rem, 96vw)' }"
    :breakpoints="{ '960px': '96vw' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-3">
      <p
        v-if="flow === 'import' && stepLabel"
        class="text-surface-600 m-0 text-sm font-semibold"
      >
        {{ stepLabel }}
      </p>

      <!-- Choose -->
      <div v-if="flow === 'choose'" class="flex flex-col gap-3">
        <p class="text-surface-600 m-0 text-sm">
          {{
            t(
              'objectList.importExport.chooseHint',
              'Export the current filtered list, or import records from a CSV file.',
            )
          }}
        </p>
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            icon="pi pi-download"
            :label="t('objectList.importExport.exportCsv', 'Export CSV')"
            :disabled="!canExport || busy"
            @click="startExport"
          />
          <Button
            type="button"
            icon="pi pi-upload"
            severity="secondary"
            outlined
            :label="t('objectList.importExport.importCsv', 'Import CSV')"
            :disabled="!canImport || busy"
            @click="startImport"
          />
        </div>
        <p
          v-if="!canImport || !canExport"
          class="text-surface-500 m-0 text-xs"
        >
          {{
            !canImport && !canExport
              ? t(
                  'objectList.importExport.noImportExportPermission',
                  'You do not have Import or Export permission for this object.',
                )
              : !canImport
                ? t(
                    'objectList.importExport.noImportPermission',
                    'You do not have Import permission for this object (also needs Create or Update).',
                  )
                : t(
                    'objectList.importExport.noExportPermission',
                    'You do not have Export permission for this object.',
                  )
          }}
        </p>
      </div>

      <!-- Export -->
      <div v-else-if="flow === 'export'" class="flex flex-col gap-3">
        <p class="text-surface-600 m-0 text-sm">
          {{
            t(
              'objectList.importExport.exportHint',
              'Exports up to {max} rows using the current list filter. All source fields are listed; pick parent paths like price_group.name for related values (bare relations export as ids).',
              { max: COLLECTION_CSV_MAX_ROWS },
            )
          }}
        </p>
        <div class="flex flex-col gap-1">
          <label class="text-surface-700 text-sm font-semibold">
            {{ t('objectList.importExport.fields', 'Fields') }}
          </label>
          <MultiSelect
            v-model="exportFieldKeys"
            :options="exportFieldOptions"
            option-label="label"
            option-value="value"
            display="chip"
            filter
            :filter-placeholder="t('objectList.importExport.searchFields', 'Search fields…')"
            class="w-full"
            :placeholder="t('objectList.importExport.selectFields', 'Select fields')"
          />
        </div>
      </div>

      <!-- Import: upload -->
      <div v-else-if="flow === 'import' && importStep === 'upload'" class="flex flex-col gap-3">
        <p class="text-surface-600 m-0 text-sm">
          {{
            t(
              'objectList.importExport.uploadHint',
              'Choose a UTF-8 CSV file. The first row must contain column headers.',
            )
          }}
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          class="text-sm"
          :disabled="busy"
          @change="onFileSelected"
        />
      </div>

      <!-- Import: map -->
      <div v-else-if="flow === 'import' && importStep === 'map'" class="flex flex-col gap-3">
        <p class="text-surface-600 m-0 text-sm">
          {{
            t(
              'objectList.importExport.mapHint',
              'File: {name} · {rows} data rows · {mapped} columns mapped.',
              {
                name: fileName || '—',
                rows: parsed?.rows.length ?? 0,
                mapped: mappedCount,
              },
            )
          }}
        </p>
        <p class="text-surface-500 m-0 text-xs">
          {{
            t(
              'objectList.importExport.lookupViaHint',
              'For each lookup: Record Id (safest), Name, External Id (unique), or any related Field (e.g. item.description).',
            )
          }}
        </p>
        <div class="max-h-72 overflow-auto">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="text-left">
                <th class="border-b border-surface-200 p-2">
                  {{ t('objectList.importExport.csvColumn', 'CSV column') }}
                </th>
                <th class="border-b border-surface-200 p-2">
                  {{ t('objectList.importExport.targetField', 'Target field') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(mapping, index) in mappings" :key="`${mapping.column}-${index}`">
                <td class="border-b border-surface-100 p-2 align-middle font-mono text-xs">
                  {{ mapping.column }}
                </td>
                <td class="border-b border-surface-100 p-2">
                  <Select
                    v-model="mappings[index].field"
                    :options="fieldSelectOptions"
                    option-label="label"
                    option-value="value"
                    class="w-full"
                    size="small"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Import: options -->
      <div v-else-if="flow === 'import' && importStep === 'options'" class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-surface-700 text-sm font-semibold">
            {{ t('objectList.importExport.mode', 'Import mode') }}
          </label>
          <SelectButton
            v-model="importMode"
            :options="importModeOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
          />
        </div>
        <div
          v-if="importMode === 'update' || importMode === 'upsert'"
          class="flex flex-col gap-1"
        >
          <label class="text-surface-700 text-sm font-semibold">
            {{ t('objectList.importExport.matchFields', 'Match fields') }}
          </label>
          <MultiSelect
            v-model="matchFields"
            :options="matchFieldOptions"
            option-label="label"
            option-value="value"
            display="chip"
            class="w-full"
            :placeholder="t('objectList.importExport.selectMatchFields', 'Select match fields')"
          />
          <p class="text-surface-500 m-0 text-xs">
            {{
              t(
                'objectList.importExport.matchFieldsHint',
                'Find existing rows on this object after lookups run. Map item.description on the previous step, then match on Item (item) — the resolved id — not item.description.',
              )
            }}
          </p>
        </div>
      </div>

      <!-- Import: preview -->
      <div v-else-if="flow === 'import' && importStep === 'preview'" class="flex flex-col gap-3">
        <div class="text-surface-700 flex flex-wrap gap-3 text-sm">
          <span>
            {{
              t('objectList.importExport.previewCreate', 'Create: {count}', {
                count: preview?.created ?? 0,
              })
            }}
          </span>
          <span>
            {{
              t('objectList.importExport.previewUpdate', 'Update: {count}', {
                count: preview?.updated ?? 0,
              })
            }}
          </span>
          <span>
            {{
              t('objectList.importExport.previewSkip', 'Skip: {count}', {
                count: preview?.skipped ?? 0,
              })
            }}
          </span>
          <span>
            {{
              t('objectList.importExport.previewFail', 'Issues: {count}', {
                count: preview?.failed ?? 0,
              })
            }}
          </span>
        </div>
        <p class="text-surface-500 m-0 text-sm">
          {{
            t(
              'objectList.importExport.previewReady',
              'Good rows will import; rows with issues are skipped and listed in the log.',
            )
          }}
        </p>
        <div v-if="previewLogRows.length" class="max-h-56 overflow-auto">
          <DataTable :value="previewLogRows" size="small" striped-rows>
            <Column
              field="row"
              :header="t('objectList.importExport.issueRow', 'Row')"
              style="width: 4rem"
            />
            <Column
              :header="t('objectList.importExport.previewAction', 'Action')"
              style="width: 6rem"
            >
              <template #body="{ data }">
                {{ logStatusLabel(data.status) }}
              </template>
            </Column>
            <Column
              field="recordId"
              :header="t('objectList.importExport.previewRecordId', 'Record Id')"
              style="width: 10rem"
            />
            <Column
              field="message"
              :header="t('objectList.importExport.issueMessage', 'Message')"
              style="width: 14rem"
            />
            <Column
              field="values"
              :header="t('objectList.importExport.previewValues', 'Values')"
            />
          </DataTable>
        </div>
        <ProgressBar
          v-if="busy && progressTotal > 0"
          :value="Math.round((progressDone / progressTotal) * 100)"
        />
      </div>

      <!-- Import: result -->
      <div v-else-if="flow === 'import' && importStep === 'result'" class="flex flex-col gap-3">
        <div class="text-surface-700 flex flex-wrap gap-3 text-sm">
          <span>
            {{
              t('objectList.importExport.resultCreated', 'Created: {count}', {
                count: runResult?.created ?? 0,
              })
            }}
          </span>
          <span>
            {{
              t('objectList.importExport.resultUpdated', 'Updated: {count}', {
                count: runResult?.updated ?? 0,
              })
            }}
          </span>
          <span>
            {{
              t('objectList.importExport.resultSkipped', 'Skipped: {count}', {
                count: runResult?.skipped ?? 0,
              })
            }}
          </span>
          <span>
            {{
              t('objectList.importExport.resultFailed', 'Failed: {count}', {
                count: runResult?.failed ?? 0,
              })
            }}
          </span>
        </div>
        <p class="text-surface-500 m-0 text-sm">
          {{
            t(
              'objectList.importExport.resultLogHint',
              'Import finished. A detailed CSV log was downloaded; you can download it again below.',
            )
          }}
        </p>
        <div v-if="resultLogRows.length" class="max-h-56 overflow-auto">
          <DataTable :value="resultLogRows" size="small" striped-rows>
            <Column
              field="row"
              :header="t('objectList.importExport.issueRow', 'Row')"
              style="width: 4rem"
            />
            <Column
              :header="t('objectList.importExport.previewAction', 'Action')"
              style="width: 6rem"
            >
              <template #body="{ data }">
                {{ logStatusLabel(data.status) }}
              </template>
            </Column>
            <Column
              field="recordId"
              :header="t('objectList.importExport.previewRecordId', 'Record Id')"
              style="width: 10rem"
            />
            <Column
              field="message"
              :header="t('objectList.importExport.issueMessage', 'Message')"
              style="width: 14rem"
            />
            <Column
              field="values"
              :header="t('objectList.importExport.previewValues', 'Values')"
            />
          </DataTable>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-2">
        <div class="flex gap-2">
          <Button
            v-if="flow !== 'choose'"
            type="button"
            :label="t('objectList.importExport.back', 'Back')"
            severity="secondary"
            text
            :disabled="busy"
            @click="
              flow === 'import' && importStep !== 'upload' && importStep !== 'result'
                ? backImportStep()
                : backToChoose()
            "
          />
        </div>
        <div class="flex gap-2">
          <Button
            type="button"
            :label="t('common.close', 'Close')"
            severity="secondary"
            outlined
            :disabled="busy"
            @click="close"
          />
          <Button
            v-if="flow === 'export'"
            type="button"
            icon="pi pi-download"
            :label="t('objectList.importExport.download', 'Download')"
            :loading="busy"
            :disabled="exportFieldKeys.length === 0"
            @click="doExport"
          />
          <Button
            v-else-if="flow === 'import' && importStep === 'map'"
            type="button"
            :label="t('objectList.importExport.next', 'Next')"
            :disabled="busy || mappedCount === 0"
            @click="goImportOptions"
          />
          <Button
            v-else-if="flow === 'import' && importStep === 'options'"
            type="button"
            :label="t('objectList.importExport.preview', 'Preview')"
            :loading="busy"
            @click="runDryPreview"
          />
          <Button
            v-else-if="flow === 'import' && importStep === 'preview'"
            type="button"
            icon="pi pi-check"
            :label="t('objectList.importExport.runImport', 'Import')"
            :loading="busy"
            :disabled="!preview || preview.plans.length === 0"
            @click="commitImport"
          />
          <Button
            v-else-if="flow === 'import' && importStep === 'result'"
            type="button"
            icon="pi pi-download"
            :label="t('objectList.importExport.downloadLog', 'Download log')"
            :disabled="!resultLogRows.length"
            @click="downloadResultLog"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>
