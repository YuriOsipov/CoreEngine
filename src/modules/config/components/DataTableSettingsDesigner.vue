<script lang="ts">
export default {
  name: 'DataTableSettingsDesigner',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import type {
  BarcodeScanMatchMode,
  BarcodeScanSettings,
  DataTableColumnConfig,
  DataTableSettings,
  FieldDefinition,
  ListViewAction,
  RelationDefinition,
  RelatedTransferSettings,
} from '@/interfaces'
import { useTranslation } from '@/core/translation'
import {
  buildFieldTreeNodes,
  collectExpandedTreeKeys,
  filterFieldTreeNodes,
  pruneSelectedFieldTreeNodes,
} from '@/core/fieldOptions'
import { resolveColumnFieldPath } from '@/core/dataTableFieldPath'
import {
  keysEqual,
  relatedCollectionForCollectionField,
  relationField,
  relationManyCollection,
  relationRelatedCollection,
} from '@/core/relationHelpers'
import { isFieldM2O } from '@/modules/entities/utils/relatedTransferSchema'
import { listDataTableFields, normalizeTableSettings, DEFAULT_RELATED_ROW_LIMIT } from '@/modules/entities/services/tableSettings'
import {
  getCachedCollectionFields,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import { loadDocTemplateListItems } from '@/modules/documents/services/docTemplateService'
import { buildListFilterMetaBlock } from '@/core/listFilterUtils'
import {
  ALL_RECORDS_FILTER_ID,
} from '@/modules/config/services/listFilterSettings'
import { loadListViews } from '@/modules/config/services/listViewSettings'
import { RECENTLY_VIEWED_FILTER_ID } from '@/modules/dashboard/services/recentRecords'
import { isDateComponent } from '@/core/dateFormatting'
import { supportsInlineCellEditor } from '@/core/inlineCellEdit'
import { DIALOG_SORTABLE_ATTRS } from '../utils/dialogSortable'
import BulkInsertBuilder from './BulkInsertBuilder.vue'
import SetupLayoutEditorDialog from './setup/SetupLayoutEditorDialog.vue'

const props = defineProps<{
  collection: string
  parentCollection?: string
  hideBatchInsert?: boolean
  /** @deprecated Detail panel moved to Page Layout settings. */
  hideDetailPanel?: boolean
  disableGrouping?: boolean
  /** Current list view filter conditions for `$payload.meta.filter` sample. */
  listViewConditions?: Array<{
    id: string
    field: string
    operator: string
    value: unknown
    type?: string
    userVisible?: boolean
    required?: boolean
    fieldWidth?: number
  }> | null
  /** List layout / view id — used to reload Filter conditions when opening Template. */
  listViewId?: string | null
  modelValue: DataTableSettings
}>()
const { t } = useTranslation()

const emit = defineEmits<{
  'update:modelValue': [settings: DataTableSettings]
}>()

const fields = ref<DataTableColumnConfig[]>([])
const schemaFields = ref<FieldDefinition[]>([])
const nestedFieldsByCollection = ref<Record<string, FieldDefinition[]>>({})
const relationDefinitions = ref<RelationDefinition[]>([])
const localColumns = ref<DataTableColumnConfig[]>([])
const bulkInsertDialogVisible = ref(false)
const bulkInsertDraft = ref<RelatedTransferSettings | null>(null)
const bulkInsertValid = ref(false)
const fixedTargetParentField = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const availableFieldSearch = ref('')
const expandedTreeKeys = ref<Record<string, boolean>>({})
const listActionsCollapsed = ref(true)

const selectedColumns = computed(() =>
  localColumns.value.filter((column) => column.enabled !== false),
)
const selectedColumnsModel = computed({
  get: () => selectedColumns.value,
  set: (columns: DataTableColumnConfig[]) => {
    reorderColumns(columns)
  },
})
const selectedFieldSet = computed(
  () => new Set(selectedColumns.value.map((column) => column.field)),
)
const relatedCollectionForField = (field: FieldDefinition): string =>
  relatedCollectionForCollectionField(
    relationDefinitions.value,
    props.collection,
    field.field,
  ) || field.schema?.foreign_key_table || ''

const availableTreeNodes = computed(() => {
  const tree = buildFieldTreeNodes(
    schemaFields.value,
    nestedFieldsByCollection.value,
    relatedCollectionForField,
  )
  return pruneSelectedFieldTreeNodes(tree, selectedFieldSet.value)
})

const filteredAvailableTreeNodes = computed(() =>
  filterFieldTreeNodes(availableTreeNodes.value, availableFieldSearch.value),
)

watch(
  [filteredAvailableTreeNodes, availableFieldSearch],
  ([nodes, query]) => {
    if (query.trim()) {
      expandedTreeKeys.value = collectExpandedTreeKeys(nodes)
    }
  },
)
const sortOptions = computed(() => {
  const options: Array<{ label: string; value: string }> = [
    { label: t('tableSettings.noDefaultSort', 'No default sort'), value: '' },
    {
      label: t('tableSettings.recordLinkPrimaryKey', 'Primary key (Id)'),
      value: 'id',
    },
  ]
  const seen = new Set(['', 'id'])
  for (const column of selectedColumns.value) {
    const field = String(column.field ?? '').trim()
    if (!field || seen.has(field)) continue
    seen.add(field)
    options.push({ label: column.header, value: field })
  }
  const current = String(props.modelValue.sort?.field ?? '').trim()
  if (current && !seen.has(current)) {
    options.push({ label: current, value: current })
  }
  return options
})
const groupByOptions = computed(() => [
  { label: t('tableSettings.noGrouping', 'No grouping'), value: '' },
  ...selectedColumns.value.map((column) => ({
    label: column.header,
    value: column.field,
  })),
])
const groupByField = computed({
  get: () => props.modelValue.groupBy?.field ?? '',
  set: (field: string) => {
    updateSettings({
      ...props.modelValue,
      groupBy: field
        ? {
            field,
            expandable: props.modelValue.groupBy?.expandable !== false,
          }
        : null,
    })
  },
})
const groupByExpandable = computed({
  get: () => props.modelValue.groupBy?.expandable !== false,
  set: (expandable: boolean) => {
    const field = props.modelValue.groupBy?.field
    if (!field) return
    updateSettings({
      ...props.modelValue,
      groupBy: { field, expandable },
    })
  },
})
const sortField = computed({
  get: () => props.modelValue.sort?.field ?? '',
  set: (field: string) => {
    updateSettings({
      ...props.modelValue,
      sort: field
        ? {
            field,
            order: props.modelValue.sort?.order === -1 ? -1 : 1,
          }
        : null,
    })
  },
})
const sortOrder = computed({
  get: () => props.modelValue.sort?.order ?? 1,
  set: (order: 1 | -1) => {
    const field = props.modelValue.sort?.field
    if (!field) return
    updateSettings({
      ...props.modelValue,
      sort: { field, order },
    })
  },
})
const sortOrderOptions = [
  { label: t('tableSettings.ascending', 'Ascending'), value: 1 },
  { label: t('tableSettings.descending', 'Descending'), value: -1 },
]
const recordLinkFieldOptions = computed(() => [
  {
    label: t('tableSettings.recordLinkName', 'Name'),
    value: '',
  },
  {
    label: t('tableSettings.recordLinkPrimaryKey', 'Primary key (Id)'),
    value: 'id',
  },
  ...selectedColumns.value
    .filter(
      (column) =>
        !column.relatedCollection &&
        column.field !== 'id' &&
        column.field !== 'name',
    )
    .map((column) => ({
      label: column.header,
      value: column.field,
    })),
])
const recordLinkField = computed({
  get: () => props.modelValue.recordLinkField ?? '',
  set: (field: string) => {
    updateSettings({
      ...props.modelValue,
      recordLinkField: field.trim() || null,
    })
  },
})
const inlineEditRefreshOptions = computed(() => [
  {
    label: t('tableSettings.inlineEditRefreshOff', 'Do not refresh (default)'),
    value: 'off',
  },
  {
    label: t('tableSettings.inlineEditRefreshRow', 'Refresh full row'),
    value: 'row',
  },
  {
    label: t('tableSettings.inlineEditRefreshSelected', 'Refresh selected fields'),
    value: 'fields',
  },
])

const inlineEditRefresh = computed({
  get: () => props.modelValue.inlineEditRefresh ?? 'off',
  set: (value: 'off' | 'row' | 'fields') => {
    updateSettings({
      ...props.modelValue,
      inlineEditRefresh: value === 'off' ? undefined : value,
      inlineEditRefreshFields:
        value === 'fields'
          ? (props.modelValue.inlineEditRefreshFields ?? [])
          : undefined,
    })
  },
})

const inlineEditRefreshFields = computed({
  get: () => props.modelValue.inlineEditRefreshFields ?? [],
  set: (fields: string[]) => {
    updateSettings({
      ...props.modelValue,
      inlineEditRefresh: 'fields',
      inlineEditRefreshFields: fields,
    })
  },
})

const barcodeScanEnabled = computed({
  get: () => Boolean(props.modelValue.barcodeScan?.enabled),
  set: (enabled: boolean) => {
    if (!enabled) {
      updateSettings({
        ...props.modelValue,
        barcodeScan: null,
      })
      return
    }
    const current = props.modelValue.barcodeScan
    updateSettings({
      ...props.modelValue,
      barcodeScan: {
        enabled: true,
        field: current?.field?.trim() || 'id',
        matchMode: current?.matchMode ?? 'open-or-filter',
        defaultScanModeOn: current?.defaultScanModeOn ?? false,
        setFields: current?.setFields ?? null,
        updateField: current?.updateField ?? null,
        confirmUpdate: current?.confirmUpdate ?? false,
      },
    })
  },
})

const barcodeScanField = computed({
  get: () => props.modelValue.barcodeScan?.field ?? 'id',
  set: (field: string) => {
    patchBarcodeScan({ field: String(field ?? '').trim() || 'id' })
  },
})

const barcodeScanMatchMode = computed({
  get: () => props.modelValue.barcodeScan?.matchMode ?? 'open-or-filter',
  set: (matchMode: BarcodeScanMatchMode) => {
    patchBarcodeScan({ matchMode })
  },
})

const barcodeScanDefaultOn = computed({
  get: () => Boolean(props.modelValue.barcodeScan?.defaultScanModeOn),
  set: (defaultScanModeOn: boolean) => {
    patchBarcodeScan({ defaultScanModeOn })
  },
})

const barcodeScanConfirmUpdate = computed({
  get: () => Boolean(props.modelValue.barcodeScan?.confirmUpdate),
  set: (confirmUpdate: boolean) => {
    patchBarcodeScan({ confirmUpdate })
  },
})

const barcodeScanUpdateField = computed({
  get: () => props.modelValue.barcodeScan?.updateField ?? null,
  set: (updateField: string | null) => {
    patchBarcodeScan({ updateField: updateField?.trim() || null })
  },
})

interface BarcodeSetFieldRow {
  field: string
  value: string
}

const barcodeSetFieldRows = computed({
  get: (): BarcodeSetFieldRow[] => {
    const setFields = props.modelValue.barcodeScan?.setFields
    if (!setFields || !Object.keys(setFields).length) {
      return [{ field: '', value: '' }]
    }
    return Object.entries(setFields).map(([field, value]) => ({
      field,
      value: value === null || value === undefined ? '$NULL' : String(value),
    }))
  },
  set: (rows: BarcodeSetFieldRow[]) => {
    const setFields: Record<string, unknown> = {}
    for (const row of rows) {
      const field = row.field?.trim()
      if (!field) continue
      setFields[field] = row.value
    }
    patchBarcodeScan({
      setFields: Object.keys(setFields).length ? setFields : null,
    })
  },
})

const barcodeMatchModeOptions = computed(() => [
  {
    label: t('tableSettings.barcodeMatchOpenOrFilter', 'Open unique / filter many'),
    value: 'open-or-filter',
  },
  {
    label: t('tableSettings.barcodeMatchOpen', 'Open record'),
    value: 'open',
  },
  {
    label: t('tableSettings.barcodeMatchFilter', 'Filter list'),
    value: 'filter',
  },
])

const barcodeFieldOptions = computed(() =>
  schemaFields.value
    .filter((field) => field.field && !field.meta?.hidden)
    .map((field) => ({
      label: field.field,
      value: field.field,
    })),
)

function patchBarcodeScan(patch: Partial<BarcodeScanSettings>): void {
  const current = props.modelValue.barcodeScan
  if (!current?.enabled && !patch.enabled) {
    updateSettings({
      ...props.modelValue,
      barcodeScan: {
        enabled: true,
        field: patch.field?.trim() || 'id',
        matchMode: patch.matchMode ?? 'open-or-filter',
        ...patch,
      },
    })
    return
  }
  updateSettings({
    ...props.modelValue,
    barcodeScan: {
      enabled: true,
      field: current?.field?.trim() || 'id',
      matchMode: current?.matchMode ?? 'open-or-filter',
      defaultScanModeOn: current?.defaultScanModeOn,
      setFields: current?.setFields ?? null,
      updateField: current?.updateField ?? null,
      confirmUpdate: current?.confirmUpdate,
      ...patch,
    },
  })
}

/** Keep `{{SUM(...)}}` out of the Vue template — nested mustaches break the parser. */
const barcodeSetFieldsHintText = computed(() =>
  t(
    'tableSettings.barcodeSetFieldsHint',
    'Tokens: $NOW, $NULL, $SCAN. Math: base_price + 2, base_price + group, or {{SUM(base_price, 2)}}. Applied only on a unique match.',
  ),
)

function addBarcodeSetFieldRow(): void {
  barcodeSetFieldRows.value = [...barcodeSetFieldRows.value, { field: '', value: '' }]
}

function removeBarcodeSetFieldRow(index: number): void {
  const next = barcodeSetFieldRows.value.filter((_, i) => i !== index)
  barcodeSetFieldRows.value = next.length ? next : [{ field: '', value: '' }]
}

function updateBarcodeSetFieldRow(
  index: number,
  patch: Partial<BarcodeSetFieldRow>,
): void {
  const next = barcodeSetFieldRows.value.map((row, i) =>
    i === index ? { ...row, ...patch } : row,
  )
  barcodeSetFieldRows.value = next
}

const rowLimit = computed({
  get: () => props.modelValue.rowLimit ?? DEFAULT_RELATED_ROW_LIMIT,
  set: (value: number | null) => {
    const nextValue =
      value === null || !Number.isFinite(value)
        ? undefined
        : Math.round(value)
    updateSettings({
      ...props.modelValue,
      rowLimit: nextValue,
    })
  },
})
const relatedTransferSettings = computed<RelatedTransferSettings | null>({
  get: () => props.modelValue.relatedTransfer ?? null,
  set: (relatedTransfer) => {
    updateSettings({
      ...props.modelValue,
      relatedTransfer,
    })
  },
})

const listActions = computed<ListViewAction[]>({
  get: () => props.modelValue.actions ?? [],
  set: (actions) => {
    updateSettings({
      ...props.modelValue,
      actions: actions.length > 0 ? actions : null,
    })
  },
})

const docTemplateOptions = ref<Array<{ label: string; value: string }>>([])
const actionDraftVisible = ref(false)
const actionDraft = ref<ListViewAction | null>(null)
const editingActionId = ref<string | null>(null)
const templateEditorVisible = ref(false)
const templateEditorLayoutId = ref<string | null>(null)
const templateEditorListContext = ref<{
  viewLabel?: string | null
  filter?: Record<string, unknown> | null
  filterConditions?: Array<{
    id: string
    field: string
    operator: string
    value: unknown
    type?: string
    userVisible?: boolean
    required?: boolean
    fieldWidth?: number
  }> | null
  parentCollection?: string | null
} | null>(null)

const recordScopeOptions = computed(() => [
  {
    label: t('tableSettings.listActionScopeFiltered', 'Current filter results'),
    value: 'filtered' as const,
  },
  {
    label: t('tableSettings.listActionScopeVisible', 'Visible rows only'),
    value: 'visible' as const,
  },
])

const listActionBehaviorOptions = computed(() => [
  {
    label: t('tableSettings.listActionBehaviorDocument', 'Document report'),
    value: 'openDocument' as const,
  },
  {
    label: t('tableSettings.listActionBehaviorBulkUpdate', 'Bulk update'),
    value: 'bulkUpdate' as const,
  },
])

const viewModeOptions = computed(() => [
  { label: t('formBuilder.documentViewPdf', 'PDF'), value: 'pdf' as const },
  { label: t('formBuilder.documentViewHtml', 'HTML'), value: 'html' as const },
])

const DEFAULT_LIST_BULK_FORMULA = '{{source}} * {{prompt}}'
const LIST_BULK_FORMULA_PRESETS = computed(() => [
  {
    label: t('formBuilder.bulkFormulaPresetMultiply', '× Prompt'),
    value: '{{source}} * {{prompt}}',
  },
  {
    label: t('formBuilder.bulkFormulaPresetPercentOff', 'Discount %'),
    value: '{{source}} * (1 - {{prompt}} / 100)',
  },
])

function isNumericFieldDefinition(field: FieldDefinition): boolean {
  const type = String(field.type ?? '').toLowerCase()
  if (
    type.includes('int')
    || type.includes('float')
    || type.includes('decimal')
    || type.includes('numeric')
    || type === 'number'
    || type === 'biginteger'
    || type === 'double'
    || type === 'real'
    || type === 'money'
  ) {
    return true
  }
  const iface = String(field.meta?.interface ?? '').toLowerCase()
  return (
    iface.includes('input-number')
    || iface.includes('input-decimal')
    || iface.includes('input-float')
    || iface.includes('currency')
    || iface.includes('slider')
    || iface.includes('numeric')
  )
}

function fieldOptionLabel(field: FieldDefinition): string {
  const translated = field.meta?.translations?.find((entry) => entry.translation?.trim())
    ?.translation
  return translated?.trim() || field.field
}

const listBulkTargetFieldOptions = computed(() => {
  const numeric = schemaFields.value
    .filter((field) => isNumericFieldDefinition(field) && !field.schema?.is_primary_key)
    .map((field) => ({ label: fieldOptionLabel(field), value: field.field }))
  if (numeric.length > 0) return numeric
  return schemaFields.value
    .filter((field) => !field.schema?.is_primary_key)
    .map((field) => ({ label: fieldOptionLabel(field), value: field.field }))
})

const listBulkSourceM2oOptions = computed(() =>
  schemaFields.value
    .filter((field) =>
      isFieldM2O(
        props.collection,
        field.field,
        schemaFields.value,
        relationDefinitions.value,
      ),
    )
    .map((field) => ({ label: fieldOptionLabel(field), value: field.field })),
)

const listBulkSourceNestedOptions = computed(() => {
  const m2o = actionDraftBulkSourceM2o.value
  if (!m2o) return [] as Array<{ label: string; value: string }>
  const related = relatedCollectionForCollectionField(
    relationDefinitions.value,
    props.collection,
    m2o,
  )
  const nested = related ? nestedFieldsByCollection.value[related] ?? [] : []
  return nested
    .filter((field) => isNumericFieldDefinition(field) && !field.schema?.is_primary_key)
    .map((field) => ({ label: fieldOptionLabel(field), value: field.field }))
})

const listBulkDirectSourceOptions = computed(() =>
  schemaFields.value
    .filter((field) => isNumericFieldDefinition(field) && !field.schema?.is_primary_key)
    .map((field) => ({ label: fieldOptionLabel(field), value: field.field })),
)

const actionDraftBulkSourceM2o = computed({
  get: () => {
    const path = actionDraft.value?.bulkUpdate?.sourcePath ?? ''
    const [root] = path.split('.')
    if (!root) return ''
    const isM2o = listBulkSourceM2oOptions.value.some((opt) => opt.value === root)
    return isM2o ? root : ''
  },
  set: (m2oField: string) => {
    if (!actionDraft.value?.bulkUpdate) return
    actionDraft.value.bulkUpdate.sourcePath = m2oField ? `${m2oField}.` : ''
  },
})

const actionDraftBulkSourceNested = computed({
  get: () => {
    const path = actionDraft.value?.bulkUpdate?.sourcePath ?? ''
    const parts = path.split('.')
    return parts.length > 1 ? parts.slice(1).join('.') : ''
  },
  set: (nested: string) => {
    if (!actionDraft.value?.bulkUpdate) return
    const m2o = actionDraftBulkSourceM2o.value
    actionDraft.value.bulkUpdate.sourcePath =
      m2o && nested ? `${m2o}.${nested}` : m2o ? `${m2o}.` : nested
  },
})

const actionDraftBulkDirectSource = computed({
  get: () => {
    const path = actionDraft.value?.bulkUpdate?.sourcePath ?? ''
    if (!path || path.includes('.')) return ''
    return path
  },
  set: (field: string) => {
    if (!actionDraft.value?.bulkUpdate) return
    actionDraft.value.bulkUpdate.sourcePath = field
  },
})

const listBulkFormulaPreview = computed(() => {
  const target =
    actionDraft.value?.bulkUpdate?.targetField?.trim()
    || t('formBuilder.bulkFormulaTargetPlaceholder', 'target')
  const formula =
    actionDraft.value?.bulkUpdate?.formula?.trim() || DEFAULT_LIST_BULK_FORMULA
  return `${target} = ${formula}`
})

watch(
  () => props.collection,
  (collection) => {
    if (!collection) {
      docTemplateOptions.value = []
      return
    }
    void loadDocTemplateOptions(collection)
  },
  { immediate: true },
)

async function loadDocTemplateOptions(collection: string): Promise<void> {
  try {
    const items = await loadDocTemplateListItems(collection)
    docTemplateOptions.value = items.map((item) => ({
      label: item.name,
      value: item.id,
    }))
  } catch {
    docTemplateOptions.value = []
  }
}

function createEmptyListAction(
  behavior: ListViewAction['behavior'] = 'openDocument',
): ListViewAction {
  if (behavior === 'bulkUpdate') {
    return {
      id: `list_action_${Date.now()}`,
      label: t('tableSettings.listActionBulkDefaultLabel', 'Bulk update'),
      behavior: 'bulkUpdate',
      bulkUpdate: {
        targetField: '',
        sourcePath: '',
        formula: DEFAULT_LIST_BULK_FORMULA,
        promptLabel: '',
        confirmBeforeRun: true,
        successMessage: t('tableSettings.listBulkUpdateCompleted', 'Records updated.'),
      },
      recordScope: 'filtered',
    }
  }
  return {
    id: `list_action_${Date.now()}`,
    label: t('tableSettings.listActionDefaultLabel', 'Document report'),
    behavior: 'openDocument',
    document: {
      templateId: null,
      viewMode: 'pdf',
      skipInteractiveFill: true,
    },
    recordScope: 'filtered',
  }
}

function openAddListAction(behavior: ListViewAction['behavior'] = 'openDocument'): void {
  editingActionId.value = null
  actionDraft.value = createEmptyListAction(behavior)
  actionDraftVisible.value = true
}

function openEditListAction(action: ListViewAction): void {
  editingActionId.value = action.id
  if (action.behavior === 'bulkUpdate') {
    actionDraft.value = {
      ...action,
      bulkUpdate: {
        targetField: action.bulkUpdate?.targetField ?? '',
        sourcePath: action.bulkUpdate?.sourcePath ?? '',
        formula: action.bulkUpdate?.formula?.trim() || DEFAULT_LIST_BULK_FORMULA,
        promptLabel: action.bulkUpdate?.promptLabel ?? '',
        confirmBeforeRun: action.bulkUpdate?.confirmBeforeRun !== false,
        successMessage:
          action.bulkUpdate?.successMessage
          || t('tableSettings.listBulkUpdateCompleted', 'Records updated.'),
      },
    }
  } else {
    actionDraft.value = {
      ...action,
      behavior: 'openDocument',
      document: {
        templateId: action.document?.templateId ?? null,
        viewMode: action.document?.viewMode === 'html' ? 'html' : 'pdf',
        skipInteractiveFill: action.document?.skipInteractiveFill !== false,
      },
    }
  }
  actionDraftVisible.value = true
}

function removeListAction(actionId: string): void {
  listActions.value = listActions.value.filter((action) => action.id !== actionId)
}

function onListActionBehaviorChange(behavior: ListViewAction['behavior']): void {
  if (!actionDraft.value) return
  const label = actionDraft.value.label
  const id = actionDraft.value.id
  const recordScope = actionDraft.value.recordScope
  const next = createEmptyListAction(behavior)
  next.id = id
  next.label = label
  next.recordScope = recordScope
  actionDraft.value = next
}

function applyListActionDraft(): void {
  const draft = actionDraft.value
  if (!draft) return
  const label = draft.label.trim()
  if (!label) return

  let next: ListViewAction
  if (draft.behavior === 'bulkUpdate') {
    const targetField = draft.bulkUpdate?.targetField?.trim() ?? ''
    const sourcePath = draft.bulkUpdate?.sourcePath?.trim() ?? ''
    if (!targetField || !sourcePath || sourcePath.endsWith('.')) return
    next = {
      id: draft.id,
      label,
      behavior: 'bulkUpdate',
      bulkUpdate: {
        targetField,
        sourcePath,
        formula: draft.bulkUpdate?.formula?.trim() || DEFAULT_LIST_BULK_FORMULA,
        promptLabel: draft.bulkUpdate?.promptLabel?.trim() ?? '',
        confirmBeforeRun: draft.bulkUpdate?.confirmBeforeRun !== false,
        successMessage:
          draft.bulkUpdate?.successMessage?.trim()
          || t('tableSettings.listBulkUpdateCompleted', 'Records updated.'),
      },
      recordScope: draft.recordScope === 'visible' ? 'visible' : 'filtered',
    }
  } else {
    if (!draft.document?.templateId?.trim()) return
    next = {
      id: draft.id,
      label,
      behavior: 'openDocument',
      document: {
        templateId: draft.document.templateId.trim(),
        viewMode: draft.document.viewMode === 'html' ? 'html' : 'pdf',
        skipInteractiveFill: true,
      },
      recordScope: draft.recordScope === 'visible' ? 'visible' : 'filtered',
    }
  }

  if (editingActionId.value) {
    listActions.value = listActions.value.map((action) =>
      action.id === editingActionId.value ? next : action,
    )
  } else {
    listActions.value = [...listActions.value, next]
  }

  actionDraftVisible.value = false
  actionDraft.value = null
  editingActionId.value = null
}

const canApplyListActionDraft = computed(() => {
  const draft = actionDraft.value
  if (!draft?.label?.trim()) return false
  if (draft.behavior === 'bulkUpdate') {
    const target = draft.bulkUpdate?.targetField?.trim() ?? ''
    const source = draft.bulkUpdate?.sourcePath?.trim() ?? ''
    return Boolean(target && source && !source.endsWith('.'))
  }
  return Boolean(draft.document?.templateId?.trim())
})

function templateLabelForAction(action: ListViewAction): string {
  if (action.behavior === 'bulkUpdate') {
    const target = action.bulkUpdate?.targetField?.trim()
    return target
      ? t('tableSettings.listActionBulkSummary', 'Update {field}', { field: target })
      : t('tableSettings.listActionBulkDefaultLabel', 'Bulk update')
  }
  const id = action.document?.templateId
  if (!id) return t('tableSettings.listActionNoTemplate', 'No template')
  return docTemplateOptions.value.find((opt) => opt.value === id)?.label ?? id
}

function applyListBulkFormulaPreset(formula: string): void {
  if (!actionDraft.value?.bulkUpdate) return
  actionDraft.value.bulkUpdate.formula = formula
}

/**
 * Prefer live List layout Filter panel conditions; if empty, reload from the saved view.
 * Document Templates (no list action) never get these — only this entry point.
 */
async function resolveListActionFilterConditions(): Promise<Array<{
  id: string
  field: string
  operator: string
  value: unknown
  type?: string
  userVisible?: boolean
  required?: boolean
  fieldWidth?: number
}> | null> {
  if (props.listViewConditions?.length) {
    return props.listViewConditions.map((condition) => ({ ...condition }))
  }

  const viewId = props.listViewId?.trim() || ''
  if (
    !viewId ||
    viewId === ALL_RECORDS_FILTER_ID ||
    viewId === RECENTLY_VIEWED_FILTER_ID
  ) {
    return null
  }

  try {
    const views = await loadListViews(props.collection)
    const view = views.find((item) => item.id === viewId)
    if (view?.conditions?.length) {
      return view.conditions.map((condition) => ({ ...condition }))
    }
  } catch {
    // Fall through — empty meta.filter when Filter list is unavailable.
  }
  return null
}

async function openListActionTemplate(action: ListViewAction): Promise<void> {
  const templateId = action.document?.templateId?.trim()
  if (!templateId) return
  templateEditorLayoutId.value = templateId

  const parentCollection = props.parentCollection?.trim() || null
  if (parentCollection) {
    // Related-list reports: expose parent record sample instead of list filter meta.
    templateEditorListContext.value = {
      viewLabel: action.label?.trim() || null,
      parentCollection,
    }
    templateEditorVisible.value = true
    return
  }

  const filterConditions = await resolveListActionFilterConditions()
  const filter = filterConditions?.length
    ? await buildListFilterMetaBlock(props.collection, filterConditions)
    : null

  templateEditorListContext.value = {
    viewLabel: action.label?.trim() || null,
    filter,
    filterConditions,
  }
  templateEditorVisible.value = true
}

watch(
  () => props.collection,
  (collection) => {
    if (!collection) return
    void loadFields(collection)
  },
  { immediate: true },
)

watch(
  () => [props.collection, props.parentCollection ?? ''],
  () => {
    void resolveFixedTargetParentField()
  },
  { immediate: true },
)

watch(
  () => props.modelValue.columns,
  () => {
    localColumns.value = normalizeTableSettings(props.modelValue).columns
  },
  { immediate: true, deep: true },
)

async function loadFields(collection: string): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const [tableFields, collectionFields, relations] = await Promise.all([
      listDataTableFields(collection),
      getCachedCollectionFields(collection),
      getCachedRelations(),
    ])
    fields.value = tableFields
    schemaFields.value = collectionFields as unknown as FieldDefinition[]
    relationDefinitions.value = relations as unknown as RelationDefinition[]

    const relationCollections = schemaFields.value
      .map((field) =>
        relatedCollectionForCollectionField(
          relationDefinitions.value,
          collection,
          field.field,
        ) || field.schema?.foreign_key_table || '',
      )
      .filter((related): related is string => Boolean(related))
    const nestedEntries = await Promise.all(
      Array.from(new Set(relationCollections)).map(async (relatedCollection) => [
        relatedCollection,
        await getCachedCollectionFields(relatedCollection),
      ] as const),
    )
    nestedFieldsByCollection.value = Object.fromEntries(nestedEntries)
  } catch (err) {
    fields.value = []
    schemaFields.value = []
    nestedFieldsByCollection.value = {}
    error.value =
      err instanceof Error
        ? err.message
        : t('tableSettings.loadFieldsError', 'Failed to load table fields.')
  } finally {
    loading.value = false
  }
}

async function resolveFixedTargetParentField(): Promise<void> {
  if (!props.collection) {
    fixedTargetParentField.value = ''
    return
  }

  const relations = await getCachedRelations()

  if (props.parentCollection) {
    const relation = relations.find((item) =>
      keysEqual(relationManyCollection(item), props.collection) &&
      keysEqual(relationRelatedCollection(item), props.parentCollection ?? ''),
    )
    fixedTargetParentField.value = relation ? relationField(relation) : ''
    return
  }

  // Setup / list-view context has no parent collection prop — infer the
  // parent M2O on this object (e.g. visit_item.visit → visit).
  const stem = props.collection
    .replace(/_items?$/i, '')
    .replace(/items?$/i, '')
  const candidates = relations.filter((item) =>
    keysEqual(relationManyCollection(item), props.collection) &&
      Boolean(relationRelatedCollection(item)),
  )
  const preferred = candidates.find((item) => {
    const field = relationField(item)
    const related = relationRelatedCollection(item)
    return (
      /^(parent|header|owner)$/i.test(field) ||
      keysEqual(field, stem) ||
      keysEqual(related, stem)
    )
  })
  fixedTargetParentField.value = preferred
    ? relationField(preferred)
    : (candidates[0] ? relationField(candidates[0]) : '')
}

function addColumnFromTreeNode(node: { data?: unknown }): void {
  const option = node.data as { label: string; value: string } | undefined
  if (!option?.value) return
  addColumn(option)
}

function addColumn(option: { label: string; value: string }): void {
  const resolved = resolveColumnFieldPath(
    props.collection,
    option.value,
    schemaFields.value,
    relationDefinitions.value,
    nestedFieldsByCollection.value,
  )
  const existing = fields.value.find((field) => field.field === option.value)

  updateSettings({
    ...props.modelValue,
    columns: [
      ...selectedColumns.value,
      {
        field: option.value,
        header: option.label,
        component: resolved?.component ?? existing?.component,
        relatedCollection: resolved?.relatedCollection ?? existing?.relatedCollection,
        format: resolved?.format ?? existing?.format,
        enabled: true,
      },
    ],
  })
}

function removeColumn(field: string): void {
  const columns = selectedColumns.value.filter((column) => column.field !== field)
  const nextGroupBy =
    props.modelValue.groupBy?.field === field ? null : props.modelValue.groupBy ?? null
  updateSettings({
    ...props.modelValue,
    columns,
    sort: props.modelValue.sort?.field === field ? null : props.modelValue.sort ?? null,
    groupBy: nextGroupBy,
    recordLinkField:
      props.modelValue.recordLinkField === field
        ? null
        : props.modelValue.recordLinkField ?? null,
  })
}

function updateColumn(
  field: string,
  patch: Partial<DataTableColumnConfig>,
): void {
  updateSettings({
    ...props.modelValue,
    columns: selectedColumns.value.map((column) =>
      column.field === field ? { ...column, ...patch } : column,
    ),
  })
}

function reorderColumns(columns: DataTableColumnConfig[]): void {
  updateSettings({
    ...props.modelValue,
    columns: [...columns],
  })
}

function updateSettings(settings: DataTableSettings): void {
  emit('update:modelValue', normalizeTableSettings(settings))
}

function isDateColumn(column: DataTableColumnConfig): boolean {
  return isDateComponent(column.component)
}

function canEnableInlineEdit(column: DataTableColumnConfig): boolean {
  return supportsInlineCellEditor(column)
}

function enableRelatedTransfer(): void {
  openBulkInsertBuilder(defaultRelatedTransferSettings())
}

function disableRelatedTransfer(): void {
  relatedTransferSettings.value = null
  bulkInsertDialogVisible.value = false
}

function openBulkInsertBuilder(
  settings = relatedTransferSettings.value ?? defaultRelatedTransferSettings(),
): void {
  bulkInsertDraft.value = cloneRelatedTransferSettings(settings)
  bulkInsertValid.value = false
  bulkInsertDialogVisible.value = true
}

function applyBulkInsertBuilder(): void {
  if (!bulkInsertDraft.value || !bulkInsertValid.value) return
  relatedTransferSettings.value = cloneRelatedTransferSettings(bulkInsertDraft.value)
  bulkInsertDialogVisible.value = false
}

function cloneRelatedTransferSettings(settings: RelatedTransferSettings): RelatedTransferSettings {
  return {
    source: {
      mode: settings.source.mode,
      groupCollection: settings.source.groupCollection,
      itemCollection: settings.source.itemCollection,
      groupPrimaryKey: settings.source.groupPrimaryKey,
      groupParentField: settings.source.groupParentField,
      groupLabelField: settings.source.groupLabelField,
      itemPrimaryKey: settings.source.itemPrimaryKey,
      itemGroupField: settings.source.itemGroupField,
      itemLabelFields: [...(settings.source.itemLabelFields ?? [])],
      fields: [...(settings.source.fields ?? [])],
      filter: cloneJsonRecord(settings.source.filter),
    },
    target: {
      collection: settings.target.collection,
      parentField: settings.target.parentField,
      itemField: settings.target.itemField,
      duplicateKey: settings.target.duplicateKey,
      columns: settings.target.columns.map((column) => ({ ...column })),
      editableFields: [...(settings.target.editableFields ?? [])],
      defaultValues: cloneJsonRecord(settings.target.defaultValues) ?? undefined,
      totalFormulas: (settings.target.totalFormulas ?? []).map((f) => ({ ...f })),
    },
    mapping: {
      defaults: cloneJsonRecord(settings.mapping?.defaults) ?? {},
      copyFromSource: { ...(settings.mapping?.copyFromSource ?? {}) },
      values: cloneJsonRecord(settings.mapping?.values) ?? {},
      lookups: cloneJsonValue(settings.mapping?.lookups) ?? {},
    },
  }
}

function cloneJsonRecord(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function cloneJsonValue<T>(value: T | null | undefined): T | null {
  if (!value) return null
  return JSON.parse(JSON.stringify(value)) as T
}

function defaultRelatedTransferSettings(): RelatedTransferSettings {
  return {
    source: {
      mode: 'tree',
      groupCollection: '',
      itemCollection: '',
      groupPrimaryKey: 'id',
      groupParentField: null,
      groupLabelField: 'name',
      itemPrimaryKey: 'id',
      itemGroupField: '',
      itemLabelFields: ['name'],
      fields: [],
      filter: null,
    },
    target: {
      collection: props.collection,
      parentField: fixedTargetParentField.value,
      itemField: '',
      duplicateKey: '',
      columns: [],
    },
    mapping: {
      defaults: {},
      copyFromSource: {},
      values: {},
      lookups: {},
    },
  }
}

function hintTooltip(value: string) {
  return { value, class: 'table-settings-hint-tooltip' }
}

const optionsSectionHint = computed(() => {
  const parts = [
    props.disableGrouping
      ? t('tableSettings.groupByLazyHint', 'Row grouping applies to embedded related tables only.')
      : t('tableSettings.groupByHint', 'Groups rows under collapsible headers in related DataTable fields.'),
    t('tableSettings.recordLinkHint', 'Column that links to the record detail page. Primary key shows a dedicated Id column.'),
  ]
  if (groupByField.value) {
    parts.push(
      t(
        'tableSettings.sortWithGroupHint',
        'When grouping is enabled, rows are sorted by the group field first, then by the selected sort field.',
      ),
    )
  }
  if (props.parentCollection) {
    parts.push(
      t(
        'tableSettings.rowLimitHint',
        'Maximum rows shown in the related list on the form. Use View all to open the full list.',
      ),
    )
  }
  return parts.join(' ')
})

const batchInsertHint = computed(() =>
  relatedTransferSettings.value
    ? t(
        'relatedTransferSettings.enabledHint',
        'Batch insert is enabled. Open Configure to edit source and destination mappings.',
      )
    : t(
        'relatedTransferSettings.disabledHint',
        'Enable batch insert to show a configured Batch insert button on this related table.',
      ),
)
</script>

<template>
  <div class="table-settings-designer flex min-h-0 flex-1 flex-col gap-1">
    <div v-if="loading" class="table-settings-designer__loading flex items-center gap-3 text-muted-color">
      <ProgressSpinner stroke-width="4" />
      <span>{{ t('tableSettings.loadingFields', 'Loading table fields...') }}</span>
    </div>

    <Message
      v-else-if="error"
      severity="warn"
      :closable="false"
    >
      {{ error }}
    </Message>

    <template v-else>
      <section
        class="table-settings-collapse"
        :class="{ 'table-settings-collapse--collapsed': listActionsCollapsed }"
      >
        <div
          class="table-settings-collapse__header"
          role="button"
          tabindex="0"
          :aria-expanded="!listActionsCollapsed"
          @click="listActionsCollapsed = !listActionsCollapsed"
          @keydown.enter.prevent="listActionsCollapsed = !listActionsCollapsed"
          @keydown.space.prevent="listActionsCollapsed = !listActionsCollapsed"
        >
          <span class="table-settings-inline-options__label-row min-w-0 flex-1">
            <span class="table-settings-collapse__title">
              {{ t('tableSettings.listActions', 'List actions') }}
            </span>
            <button
              type="button"
              class="table-settings-hint"
              v-tooltip.bottom="hintTooltip(t(
                'tableSettings.listActionsHint',
                'Toolbar buttons for this list: document reports ($payload.records) or bulk update with a formula on filtered / visible rows. After saving a Document report with a template, use Template on the action to design Field Mapping — $payload.meta.filter comes from this list layout Filter list.',
              ))"
              :aria-label="t('common.moreInfo', 'More information')"
              @click.stop
            />
          </span>
          <i
            class="pi text-[0.75rem] shrink-0"
            :class="listActionsCollapsed ? 'pi-chevron-down' : 'pi-chevron-up'"
            aria-hidden="true"
          />
        </div>
        <div
          v-show="!listActionsCollapsed"
          class="table-settings-collapse__body"
        >
          <div class="table-settings-actions-row flex min-w-0 items-center gap-2 overflow-x-auto">
            <VueDraggableNext
              v-model="listActions"
              item-key="id"
              handle=".list-action-drag-handle"
              tag="div"
              class="flex min-w-0 items-center gap-2"
              ghost-class="opacity-50"
              v-bind="DIALOG_SORTABLE_ATTRS"
            >
              <div
                v-for="action in listActions"
                :key="action.id"
                class="table-settings-action-card flex shrink-0 items-center gap-1.5"
              >
                <button
                  type="button"
                  class="list-action-drag-handle inline-flex shrink-0 items-center justify-center border-0 bg-transparent px-0.5 py-0.5 text-surface-300 cursor-grab select-none tracking-[-0.15em] leading-none active:cursor-grabbing"
                  :aria-label="t('tableSettings.reorderListAction', 'Drag to reorder')"
                >
                  <span aria-hidden="true">⠿</span>
                </button>
                <button
                  type="button"
                  class="table-settings-action-card__name"
                  @click="openEditListAction(action)"
                >
                  {{ action.label }}
                </button>
                <Button
                  v-if="action.behavior !== 'bulkUpdate' && action.document?.templateId?.trim()"
                  :label="t('tableSettings.openListActionTemplate', 'Template')"
                  size="small"
                  severity="secondary"
                  text
                  @click="openListActionTemplate(action)"
                />
                <Button
                  icon="pi pi-times"
                  size="small"
                  severity="danger"
                  text
                  rounded
                  :aria-label="t('common.remove', 'Remove')"
                  @click="removeListAction(action.id)"
                />
              </div>
            </VueDraggableNext>
            <Button
              class="table-settings-actions-add shrink-0"
              :label="t('tableSettings.addListAction', '+ Document report')"
              size="small"
              severity="secondary"
              text
              @click="openAddListAction('openDocument')"
            />
            <Button
              class="table-settings-actions-add shrink-0"
              :label="t('tableSettings.addListBulkAction', '+ Bulk update')"
              size="small"
              severity="secondary"
              text
              @click="openAddListAction('bulkUpdate')"
            />
          </div>
          <div
            v-if="!hideBatchInsert"
            class="table-settings-batch-row flex min-w-0 flex-wrap items-center gap-1.5"
          >
            <div class="table-settings-inline-options__label-row shrink-0">
              <span class="table-settings-inline-options__label">
                {{ t('relatedTransferSettings.batchInsert', 'Batch insert') }}
              </span>
              <button
                type="button"
                class="table-settings-hint"
                v-tooltip.bottom="hintTooltip(batchInsertHint)"
                :aria-label="t('common.moreInfo', 'More information')"
              />
            </div>
            <Button
              v-if="!relatedTransferSettings"
              :label="t('relatedTransferSettings.enable', 'Enable')"
              size="small"
              severity="secondary"
              text
              @click="enableRelatedTransfer"
            />
            <template v-else>
              <Button
                :label="t('relatedTransferSettings.configure', 'Configure')"
                size="small"
                severity="secondary"
                text
                @click="openBulkInsertBuilder()"
              />
              <Button
                :label="t('relatedTransferSettings.disable', 'Disable')"
                size="small"
                severity="danger"
                text
                @click="disableRelatedTransfer"
              />
            </template>
          </div>
        </div>
      </section>

      <Splitter
        class="table-settings-designer__panels"
        layout="horizontal"
        state-key="crm.tableSettings.fieldsSplitter"
        state-storage="local"
      >
        <SplitterPanel
          :size="40"
          :min-size="22"
          class="table-settings-designer__split-pane min-h-0 min-w-0"
        >
        <div class="table-settings-panel table-settings-panel--available grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-1.5">
          <h3 class="table-settings-panel__title m-0">
            {{ t('tableSettings.availableFields', 'Available fields') }}
          </h3>
          <IconField class="table-settings-panel__search shrink-0">
            <InputIcon class="pi pi-search" />
            <InputText
              v-model="availableFieldSearch"
              size="small"
              fluid
              :placeholder="t('tableSettings.searchFields', 'Search fields...')"
            />
          </IconField>
          <div class="table-settings-panel__body">
            <Tree
              v-if="filteredAvailableTreeNodes.length > 0"
              :value="filteredAvailableTreeNodes"
              v-model:expanded-keys="expandedTreeKeys"
              class="table-settings-tree border-0 p-0"
            >
              <template #default="{ node }">
                <div class="table-settings-field-card flex items-center justify-between gap-2 w-full min-w-0">
                  <span class="truncate">{{ node.label }}</span>
                  <Button
                    icon="pi pi-plus"
                    size="small"
                    text
                    rounded
                    severity="secondary"
                    :aria-label="t('common.add', 'Add')"
                    @click.stop="addColumnFromTreeNode(node)"
                  />
                </div>
              </template>
            </Tree>
            <p v-else class="table-settings-panel__empty m-0">
              {{
                availableTreeNodes.length === 0
                  ? t('tableSettings.allFieldsSelected', 'All available fields are selected.')
                  : t('tableSettings.noMatchingFields', 'No matching fields.')
              }}
            </p>
          </div>
        </div>
        </SplitterPanel>

        <SplitterPanel
          :size="60"
          :min-size="30"
          class="table-settings-designer__split-pane min-h-0 min-w-0"
        >
        <div class="table-settings-panel table-settings-panel--selected grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1.5">
          <h3 class="table-settings-panel__title m-0">
            {{ t('tableSettings.selectedFields', 'Selected fields') }}
          </h3>
          <VueDraggableNext
            v-model="selectedColumnsModel"
            item-key="field"
            handle=".column-drag-handle"
            tag="div"
            class="table-settings-panel__body flex flex-col gap-[0.35rem]"
            ghost-class="opacity-50"
            v-bind="DIALOG_SORTABLE_ATTRS"
          >
            <div
              v-for="column in selectedColumnsModel"
              :key="column.field"
              class="table-settings-selected-row grid items-center gap-2 grid-cols-[auto_minmax(120px,1fr)_minmax(90px,140px)_minmax(120px,1fr)_auto_auto]"
            >
              <button
                type="button"
                class="column-drag-handle inline-flex items-center justify-center border-0 bg-transparent px-1 py-0.5 text-surface-300 cursor-grab select-none tracking-[-0.15em] leading-none active:cursor-grabbing"
                :aria-label="t('tableSettings.reorderField', 'Drag to reorder')"
              >
                <span aria-hidden="true">⠿</span>
              </button>
              <InputText
                :model-value="column.header"
                class="w-full"
                :placeholder="t('tableSettings.columnHeader', 'Header')"
                @update:model-value="
                  updateColumn(column.field, { header: String($event) })
                "
              />
              <code class="table-settings-selected-row__field truncate">{{ column.field }}</code>
              <InputText
                v-if="isDateColumn(column)"
                :model-value="column.format ?? ''"
                class="w-full"
                :placeholder="t('tableSettings.dateFormatExample', 'yy-mm-dd HH:mm')"
                @update:model-value="
                  updateColumn(column.field, { format: String($event).trim() || undefined })
                "
              />
              <InputText
                v-else-if="column.relatedCollection"
                :model-value="column.template ?? ''"
                class="w-full"
                :placeholder="t('tableSettings.displayTemplateExample', '{{name}}')"
                @update:model-value="
                  updateColumn(column.field, { template: String($event).trim() || undefined })
                "
              />
              <span v-else class="table-settings-selected-row__field">—</span>
              <ToggleSwitch
                :model-value="column.inlineEditable === true"
                :disabled="!canEnableInlineEdit(column)"
                :input-id="`table-inline-edit-${column.field.replace(/[^\w-]+/g, '-')}`"
                :aria-label="t('tableSettings.inlineEdit', 'Inline edit')"
                v-tooltip.bottom="
                  canEnableInlineEdit(column)
                    ? t('tableSettings.inlineEditHint', 'Allow editing this field in the list')
                    : t(
                        'tableSettings.inlineEditUnavailable',
                        'This field type cannot be edited in the list',
                      )
                "
                @update:model-value="
                  updateColumn(column.field, { inlineEditable: $event === true })
                "
              />
              <Button
                icon="pi pi-times"
                size="small"
                severity="danger"
                text
                rounded
                :aria-label="t('common.remove', 'Remove')"
                @click="removeColumn(column.field)"
              />
            </div>
          </VueDraggableNext>
          <p v-if="selectedColumns.length === 0" class="table-settings-panel__empty m-0">
            {{ t('tableSettings.addFieldsEmpty', 'Add fields to show table columns.') }}
          </p>
        </div>
        </SplitterPanel>
      </Splitter>

      <section class="table-settings-inline-options">
        <div class="table-settings-inline-options__item">
          <div class="table-settings-inline-options__label-row">
            <label class="table-settings-inline-options__label">{{ t('tableSettings.groupBy', 'Group by') }}</label>
            <button
              type="button"
              class="table-settings-hint"
              v-tooltip.bottom="hintTooltip(optionsSectionHint)"
              :aria-label="t('common.moreInfo', 'More information')"
            />
          </div>
          <Select
            v-model="groupByField"
            class="w-full"
            :options="groupByOptions"
            option-label="label"
            option-value="value"
            :placeholder="t('tableSettings.groupByField', 'Group field')"
            :disabled="disableGrouping"
          />
        </div>

        <div class="table-settings-inline-options__item table-settings-inline-options__item--toggle">
          <label class="table-settings-inline-options__label" for="table-group-expandable">
            {{ t('tableSettings.expandableGroups', 'Expandable groups') }}
          </label>
          <ToggleSwitch
            v-model="groupByExpandable"
            :disabled="disableGrouping || !groupByField"
            input-id="table-group-expandable"
          />
        </div>

        <div class="table-settings-inline-options__item">
          <label class="table-settings-inline-options__label">{{ t('tableSettings.recordLinkField', 'Record link column') }}</label>
          <Select
            v-model="recordLinkField"
            class="w-full"
            :options="recordLinkFieldOptions"
            option-label="label"
            option-value="value"
            :placeholder="t('tableSettings.recordLinkPrimaryKey', 'Primary key (Id)')"
          />
        </div>

        <div class="table-settings-inline-options__item table-settings-inline-options__item--sort">
          <label class="table-settings-inline-options__label">{{ t('tableSettings.defaultSort', 'Default sort') }}</label>
          <div class="table-settings-inline-options__sort">
            <Select
              v-model="sortField"
              class="table-settings-inline-options__sort-field"
              :options="sortOptions"
              option-label="label"
              option-value="value"
              :placeholder="t('tableSettings.sortField', 'Sort field')"
            />
            <Select
              v-model="sortOrder"
              class="table-settings-inline-options__sort-order"
              :options="sortOrderOptions"
              option-label="label"
              option-value="value"
              :disabled="!sortField"
            />
          </div>
        </div>

        <div
          v-if="parentCollection"
          class="table-settings-inline-options__item"
        >
          <label class="table-settings-inline-options__label" for="table-row-limit">
            {{ t('tableSettings.rowLimit', 'Row limit') }}
          </label>
          <InputNumber
            v-model="rowLimit"
            class="w-full"
            :min="1"
            :max="100"
            :use-grouping="false"
            show-buttons
            input-id="table-row-limit"
          />
        </div>

        <div
          class="table-settings-inline-options__item"
          :class="{ 'table-settings-inline-options__item--pair': inlineEditRefresh === 'fields' }"
        >
          <div class="table-settings-inline-options__field">
            <div class="table-settings-inline-options__label-row">
              <label class="table-settings-inline-options__label">
                {{ t('tableSettings.inlineEditRefresh', 'After inline edit') }}
              </label>
              <button
                type="button"
                class="table-settings-hint"
                v-tooltip.bottom="
                  hintTooltip(
                    t(
                      'tableSettings.inlineEditRefreshHint',
                      'Re-fetch the row after inline save so automation/formula fields (e.g. text_result) update. Off by default.',
                    ),
                  )
                "
                :aria-label="t('common.moreInfo', 'More information')"
              />
            </div>
            <Select
              v-model="inlineEditRefresh"
              class="w-full"
              :options="inlineEditRefreshOptions"
              option-label="label"
              option-value="value"
            />
          </div>

          <div
            v-if="inlineEditRefresh === 'fields'"
            class="table-settings-inline-options__field"
          >
            <label class="table-settings-inline-options__label">
              {{ t('tableSettings.inlineEditRefreshFields', 'Fields to refresh') }}
            </label>
            <MultiSelect
              v-model="inlineEditRefreshFields"
              class="w-full"
              :options="selectedColumns"
              option-label="header"
              option-value="field"
              display="chip"
              filter
              :placeholder="t('tableSettings.inlineEditRefreshFieldsPlaceholder', 'Select fields…')"
            />
          </div>
        </div>

        <div class="table-settings-inline-options__item col-span-full">
          <div class="table-settings-inline-options__label-row">
            <label class="table-settings-inline-options__label">
              {{ t('tableSettings.barcodeScan', 'Barcode scan') }}
            </label>
            <button
              type="button"
              class="table-settings-hint"
              v-tooltip.bottom="
                hintTooltip(
                  t(
                    'tableSettings.barcodeScanHint',
                    'Adds a Scan toolbar: HID scanner capture (Scan mode), manual entry, optional field updates on unique match, and a toast when nothing is found.',
                  ),
                )
              "
              :aria-label="t('common.moreInfo', 'More information')"
            />
          </div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <ToggleSwitch v-model="barcodeScanEnabled" input-id="barcode-scan-enabled" />
              <label for="barcode-scan-enabled" class="text-[0.85rem]">
                {{ t('tableSettings.barcodeScanEnable', 'Enable barcode scan') }}
              </label>
            </div>

            <template v-if="barcodeScanEnabled">
              <div class="flex flex-wrap gap-2">
                <div class="flex flex-col gap-0.5 min-w-[10rem] flex-1">
                  <label class="text-[0.75rem] text-muted-color">
                    {{ t('tableSettings.barcodeLookupField', 'Lookup field') }}
                  </label>
                  <Select
                    v-model="barcodeScanField"
                    class="w-full"
                    :options="barcodeFieldOptions"
                    option-label="label"
                    option-value="value"
                    filter
                    :placeholder="t('tableSettings.barcodeLookupFieldPlaceholder', 'Select field')"
                  />
                </div>
                <div class="flex flex-col gap-0.5 min-w-[12rem] flex-1">
                  <label class="text-[0.75rem] text-muted-color">
                    {{ t('tableSettings.barcodeMatchMode', 'On match') }}
                  </label>
                  <Select
                    v-model="barcodeScanMatchMode"
                    class="w-full"
                    :options="barcodeMatchModeOptions"
                    option-label="label"
                    option-value="value"
                  />
                </div>
                <div class="flex flex-col gap-0.5 min-w-[10rem] flex-1">
                  <label class="text-[0.75rem] text-muted-color">
                    {{ t('tableSettings.barcodeUpdateField', 'Also update field') }}
                  </label>
                  <Select
                    v-model="barcodeScanUpdateField"
                    class="w-full"
                    :options="barcodeFieldOptions"
                    option-label="label"
                    option-value="value"
                    show-clear
                    filter
                    :placeholder="t('tableSettings.barcodeUpdateFieldPlaceholder', 'Optional')"
                  />
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-4">
                <div class="flex items-center gap-2">
                  <ToggleSwitch v-model="barcodeScanDefaultOn" input-id="barcode-scan-default-on" />
                  <label for="barcode-scan-default-on" class="text-[0.85rem]">
                    {{ t('tableSettings.barcodeDefaultScanMode', 'Start in Scan mode') }}
                  </label>
                </div>
                <div class="flex items-center gap-2">
                  <ToggleSwitch
                    v-model="barcodeScanConfirmUpdate"
                    input-id="barcode-scan-confirm"
                  />
                  <label for="barcode-scan-confirm" class="text-[0.85rem]">
                    {{ t('tableSettings.barcodeConfirmUpdate', 'Confirm before update') }}
                  </label>
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[0.85rem] font-medium">
                    {{ t('tableSettings.barcodeSetFields', 'Set fields on unique match') }}
                  </span>
                  <Button
                    :label="t('tableSettings.barcodeAddSetField', '+ Field')"
                    size="small"
                    severity="secondary"
                    text
                    @click="addBarcodeSetFieldRow"
                  />
                </div>
                <p class="text-[0.75rem] text-muted-color m-0">
                  {{ barcodeSetFieldsHintText }}
                </p>
                <div
                  v-for="(row, index) in barcodeSetFieldRows"
                  :key="`barcode-set-${index}`"
                  class="flex flex-wrap items-center gap-2"
                >
                  <Select
                    :model-value="row.field"
                    class="min-w-[10rem] flex-1"
                    :options="barcodeFieldOptions"
                    option-label="label"
                    option-value="value"
                    filter
                    :placeholder="t('tableSettings.barcodeSetFieldPlaceholder', 'Field')"
                    @update:model-value="updateBarcodeSetFieldRow(index, { field: $event ?? '' })"
                  />
                  <InputText
                    :model-value="row.value"
                    class="min-w-[8rem] flex-1"
                    :placeholder="t('tableSettings.barcodeSetValuePlaceholder', 'base_price + 2')"
                    @update:model-value="updateBarcodeSetFieldRow(index, { value: $event ?? '' })"
                  />
                  <Button
                    icon="pi pi-times"
                    size="small"
                    severity="danger"
                    text
                    rounded
                    :aria-label="t('common.remove', 'Remove')"
                    @click="removeBarcodeSetFieldRow(index)"
                  />
                </div>
              </div>
            </template>
          </div>
        </div>
      </section>

      <Dialog
        v-model:visible="actionDraftVisible"
        modal
        :style="{ width: 'min(480px, 95vw)' }"
        :header="
          editingActionId
            ? t('tableSettings.editListAction', 'Edit list action')
            : t('tableSettings.addListActionTitle', 'Add list action')
        "
      >
        <div
          v-if="actionDraft"
          class="flex flex-col gap-3"
        >
          <div class="flex flex-col gap-[0.35rem]">
            <label class="text-[0.85rem] font-medium">
              {{ t('tableSettings.listActionLabel', 'Button label') }}
            </label>
            <InputText
              v-model="actionDraft.label"
              fluid
            />
          </div>
          <div class="flex flex-col gap-[0.35rem]">
            <label class="text-[0.85rem] font-medium">
              {{ t('formBuilder.actionBehavior', 'Behavior') }}
            </label>
            <Select
              :model-value="actionDraft.behavior"
              :options="listActionBehaviorOptions"
              option-label="label"
              option-value="value"
              fluid
              @update:model-value="onListActionBehaviorChange"
            />
          </div>
          <div class="flex flex-col gap-[0.35rem]">
            <label class="text-[0.85rem] font-medium">
              {{ t('tableSettings.listActionRecordScope', 'Records to include') }}
            </label>
            <Select
              v-model="actionDraft.recordScope"
              :options="recordScopeOptions"
              option-label="label"
              option-value="value"
              fluid
            />
          </div>

          <template v-if="actionDraft.behavior === 'bulkUpdate' && actionDraft.bulkUpdate">
            <div class="flex flex-col gap-[0.35rem]">
              <label class="inline-flex items-center gap-1 text-[0.85rem] font-medium">
                {{ t('formBuilder.bulkTargetField', 'Target field') }}
                <button
                  type="button"
                  class="table-settings-hint"
                  v-tooltip.bottom="hintTooltip(t('formBuilder.bulkTargetFieldHint', 'Numeric field on the related collection to update (e.g. new_price).'))"
                  :aria-label="t('common.moreInfo', 'More information')"
                />
              </label>
              <Select
                v-model="actionDraft.bulkUpdate.targetField"
                :options="listBulkTargetFieldOptions"
                option-label="label"
                option-value="value"
                :placeholder="t('formBuilder.bulkTargetFieldPlaceholder', 'Select target field')"
                filter
                fluid
              />
            </div>
            <div class="flex flex-col gap-[0.35rem]">
              <label class="inline-flex items-center gap-1 text-[0.85rem] font-medium">
                {{ t('formBuilder.bulkSourcePath', 'Source path') }}
                <button
                  type="button"
                  class="table-settings-hint"
                  v-tooltip.bottom="hintTooltip(t('tableSettings.listBulkSourceHint', 'Direct numeric field, or M2O → nested field (e.g. item.base_price).'))"
                  :aria-label="t('common.moreInfo', 'More information')"
                />
              </label>
              <Select
                v-model="actionDraftBulkDirectSource"
                :options="listBulkDirectSourceOptions"
                option-label="label"
                option-value="value"
                :placeholder="t('tableSettings.listBulkDirectSourcePlaceholder', 'Direct field (optional)')"
                show-clear
                filter
                fluid
              />
              <Select
                v-model="actionDraftBulkSourceM2o"
                :options="listBulkSourceM2oOptions"
                option-label="label"
                option-value="value"
                :placeholder="t('formBuilder.bulkSourceM2oPlaceholder', 'Related M2O field')"
                show-clear
                filter
                fluid
              />
              <Select
                v-model="actionDraftBulkSourceNested"
                :options="listBulkSourceNestedOptions"
                option-label="label"
                option-value="value"
                :placeholder="t('formBuilder.bulkSourceNestedPlaceholder', 'Nested numeric field')"
                :disabled="!actionDraftBulkSourceM2o"
                filter
                fluid
              />
            </div>
            <div class="flex flex-col gap-[0.35rem]">
              <label class="inline-flex items-center gap-1 text-[0.85rem] font-medium">
                {{ t('formBuilder.bulkFormula', 'Formula') }}
                <button
                  type="button"
                  class="table-settings-hint"
                  v-tooltip.bottom="hintTooltip(t('formBuilder.bulkFormulaHint', 'Custom arithmetic using {{source}} (from Source path) and {{prompt}} (user input). Example: {{source}} * (1 - {{prompt}} / 100)'))"
                  :aria-label="t('common.moreInfo', 'More information')"
                />
              </label>
              <InputText
                v-model="actionDraft.bulkUpdate.formula"
                :placeholder="t('formBuilder.bulkFormulaPlaceholder', '{{source}} * (1 - {{prompt}} / 100)')"
                fluid
              />
              <div class="flex flex-wrap gap-1">
                <Button
                  v-for="preset in LIST_BULK_FORMULA_PRESETS"
                  :key="preset.value"
                  :label="preset.label"
                  size="small"
                  text
                  type="button"
                  @click="applyListBulkFormulaPreset(preset.value)"
                />
              </div>
              <code class="m-0 rounded border border-surface-200 bg-surface-50 px-2 py-1.5 text-[0.8rem] text-surface-700 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200">
                {{ listBulkFormulaPreview }}
              </code>
            </div>
            <div class="flex flex-col gap-[0.35rem]">
              <label class="text-[0.85rem] font-medium">
                {{ t('formBuilder.bulkPromptLabel', 'Prompt label') }}
              </label>
              <InputText
                v-model="actionDraft.bulkUpdate.promptLabel"
                :placeholder="t('formBuilder.bulkPromptLabelPlaceholder', 'Multiplier')"
                fluid
              />
            </div>
            <div class="flex flex-col gap-[0.35rem]">
              <label class="text-[0.85rem] font-medium">
                {{ t('formBuilder.successMessage', 'Success message') }}
              </label>
              <InputText
                v-model="actionDraft.bulkUpdate.successMessage"
                fluid
              />
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-[0.85rem]">
                {{ t('formBuilder.confirmBeforeRun', 'Confirm before running') }}
              </span>
              <ToggleSwitch v-model="actionDraft.bulkUpdate.confirmBeforeRun" />
            </div>
          </template>

          <template v-else-if="actionDraft.document">
            <div class="flex flex-col gap-[0.35rem]">
              <label class="inline-flex items-center gap-1 text-[0.85rem] font-medium">
                {{ t('formBuilder.documentTemplate', 'Document template') }}
                <button
                  type="button"
                  class="table-settings-hint"
                  v-tooltip.bottom="hintTooltip(t(
                    'tableSettings.listActionDocumentTemplateHint',
                    'Pick an existing template (create one under Document Templates if needed). After Apply, use Template on the action to open the designer — Field Mapping meta.filter uses this list layout Filter list.',
                  ))"
                  :aria-label="t('common.moreInfo', 'More information')"
                />
              </label>
              <Select
                v-model="actionDraft.document.templateId"
                :options="docTemplateOptions"
                option-label="label"
                option-value="value"
                :placeholder="t('tableSettings.listActionDocumentTemplatePlaceholder', 'Select a template')"
                filter
                fluid
              />
            </div>
            <div class="flex flex-col gap-[0.35rem]">
              <label class="text-[0.85rem] font-medium">
                {{ t('formBuilder.documentViewMode', 'Show as') }}
              </label>
              <Select
                v-model="actionDraft.document.viewMode"
                :options="viewModeOptions"
                option-label="label"
                option-value="value"
                fluid
              />
            </div>
          </template>
        </div>

        <template #footer>
          <Button
            :label="t('common.cancel', 'Cancel')"
            severity="secondary"
            text
            @click="actionDraftVisible = false"
          />
          <Button
            :label="t('common.apply', 'Apply')"
            :disabled="!canApplyListActionDraft"
            @click="applyListActionDraft"
          />
        </template>
      </Dialog>

      <Dialog
        v-model:visible="bulkInsertDialogVisible"
        modal
        maximizable
        class="bulk-insert-dialog"
        :style="{ width: 'min(1200px, 95vw)' }"
        :header="t('relatedTransferSettings.bulkInsertBuilder', 'Bulk insert builder')"
      >
        <BulkInsertBuilder
          v-if="bulkInsertDraft"
          v-model="bulkInsertDraft"
          :target-collection="collection"
          :target-parent-field="fixedTargetParentField"
          @valid-change="bulkInsertValid = $event"
        />

        <template #footer>
          <Button
            :label="t('common.cancel', 'Cancel')"
            severity="secondary"
            text
            @click="bulkInsertDialogVisible = false"
          />
          <Button
            :label="t('common.apply', 'Apply')"
            severity="secondary"
            text
            :disabled="!bulkInsertValid"
            @click="applyBulkInsertBuilder"
          />
        </template>
      </Dialog>

      <SetupLayoutEditorDialog
        v-model:visible="templateEditorVisible"
        :collection="collection"
        layout-type="document"
        :layout-id="templateEditorLayoutId"
        force-list-payload-sample
        :list-source-context="templateEditorListContext"
      />
    </template>
  </div>
</template>

<style scoped>
.table-settings-designer {
  --list-wash: #edf3f4;
  --list-ink: #37352f;
  --list-line: #8fa3a8;
  --list-line-strong: #6f868c;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-family: Inter, system-ui, sans-serif;
  color: var(--list-ink);
}

.table-settings-designer__loading :deep(.p-progressspinner) {
  height: 1.5rem;
  width: 1.5rem;
}

.table-settings-collapse {
  flex-shrink: 0;
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--list-wash);
}

.table-settings-collapse__header {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
  padding: 0.4rem 0.5rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.table-settings-collapse__header:hover {
  background: rgba(55, 53, 47, 0.04);
}

.table-settings-collapse__title {
  font-size: 0.88rem;
  font-weight: 600;
  color: #111;
}

.table-settings-collapse__body {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0 0.5rem 0.45rem;
}

.table-settings-actions-row {
  padding-bottom: 0;
}

.table-settings-actions-add {
  padding-inline: 0 !important;
}

.table-settings-batch-row {
  padding-top: 0.35rem;
  border-top: 1px solid rgba(55, 53, 47, 0.08);
}

.table-settings-batch-row .table-settings-inline-options__label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #111;
}

.table-settings-batch-row .p-button {
  padding-inline: 0.35rem 0.5rem !important;
}

.table-settings-designer__panels {
  flex: 0 0 auto;
  width: 100%;
  height: min(26rem, 46vh);
  min-height: 20rem;
  max-height: min(26rem, 46vh);
  border: 0;
  background: transparent;
  overflow: hidden;
}

.table-settings-designer__panels :deep(.p-splitter) {
  height: 100%;
  min-height: 0;
}

.table-settings-designer__panels :deep(.p-splitter-panel) {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.table-settings-designer__split-pane {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.table-settings-designer__panels :deep(.p-splitter-gutter) {
  width: 6px;
  margin: 0 0.2rem;
  background: transparent;
  transition: background-color 0.12s;
}

.table-settings-designer__panels :deep(.p-splitter-gutter:hover),
.table-settings-designer__panels :deep(.p-splitter-gutter-resizing) {
  background: rgba(143, 163, 168, 0.45);
}

.table-settings-designer__panels :deep(.p-splitter-gutter-handle) {
  height: 2.5rem;
  width: 3px;
  border-radius: 999px;
  background: #8fa3a8;
}

.table-settings-panel {
  border: 0;
  border-radius: 8px;
  background: var(--list-wash);
  padding: 0.45rem 0.5rem;
  min-height: 0;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.table-settings-panel__title {
  font-size: 0.88rem;
  font-weight: 600;
  color: #111;
}

.table-settings-panel__search :deep(.p-inputtext) {
  background: #fff;
  border-color: rgba(55, 53, 47, 0.12);
  border-radius: 8px;
}

.table-settings-panel__body {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: scroll;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  -webkit-overflow-scrolling: touch;
}

.table-settings-panel__empty {
  font-size: 0.85rem;
  color: rgba(55, 53, 47, 0.45);
}

.table-settings-tree {
  width: 100%;
}

.table-settings-tree :deep(.p-tree),
.table-settings-tree :deep(.p-tree-root),
.table-settings-tree :deep(.p-tree-root-children) {
  overflow: visible;
}

.table-settings-tree :deep(.p-tree-node-content) {
  padding: 0.15rem 0;
  border-radius: 8px;
}

.table-settings-tree :deep(.p-tree-node-content:hover) {
  background: transparent;
}

.table-settings-tree :deep(.p-tree-node-toggle-button) {
  color: rgba(55, 53, 47, 0.45);
}

.table-settings-field-card {
  padding: 0.4rem 0.5rem;
  border: 1px solid rgba(55, 53, 47, 0.1);
  border-radius: 8px;
  background: #fff;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--list-ink);
}

.table-settings-field-card:hover {
  background: rgba(55, 53, 47, 0.06);
}

.table-settings-selected-row {
  padding: 0.4rem 0.5rem;
  border: 1px solid rgba(55, 53, 47, 0.1);
  border-radius: 8px;
  background: #fff;
}

.table-settings-selected-row__field {
  font-size: 0.75rem;
  color: rgba(55, 53, 47, 0.45);
}

.table-settings-inline-options {
  display: grid;
  flex-shrink: 0;
  width: 100%;
  box-sizing: border-box;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.45rem 1rem;
  align-items: end;
  border-radius: 8px;
  background: var(--list-wash);
  padding: 0.5rem;
  margin-bottom: 0.25rem;
}

.table-settings-inline-options--features {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
}

.table-settings-inline-options__item {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  max-width: 100%;
}

.table-settings-inline-options__item :deep(.p-inputnumber),
.table-settings-inline-options__item :deep(.p-inputnumber-input),
.table-settings-inline-options__item:not(.table-settings-inline-options__item--sort) :deep(.p-select),
.table-settings-inline-options__item :deep(.p-multiselect) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.table-settings-inline-options__item--sort {
  grid-column: span 2;
}

.table-settings-inline-options__item--pair {
  grid-column: 1 / -1;
  grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
  gap: 0.45rem 1rem;
  align-items: end;
}

.table-settings-inline-options__field {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.table-settings-inline-options__sort {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.table-settings-inline-options__sort-field {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  max-width: 100%;
}

.table-settings-inline-options__sort-order {
  flex: 0 0 8.5rem;
  width: 8.5rem;
  max-width: 8.5rem;
}

.table-settings-inline-options__item--toggle {
  align-content: end;
  justify-items: start;
  gap: 0.5rem;
}

.table-settings-inline-options__item--action {
  align-content: start;
}

.table-settings-inline-options__label-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.table-settings-inline-options__label {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(55, 53, 47, 0.55);
}

.table-settings-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.95rem;
  height: 0.95rem;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(55, 53, 47, 0.4);
  border-radius: 50%;
  background: transparent;
  color: rgba(55, 53, 47, 0.55);
  font-size: 0.58rem;
  font-style: italic;
  font-weight: 600;
  line-height: 1;
  cursor: help;
}

.table-settings-hint:focus-visible {
  outline: 2px solid rgba(55, 53, 47, 0.35);
  outline-offset: 2px;
}

.table-settings-hint::before {
  content: 'i';
}

.table-settings-action-card {
  padding: 0.3rem 0.5rem;
  border: 1px solid rgba(55, 53, 47, 0.1);
  border-radius: 8px;
  background: #fff;
}

.table-settings-action-card__name {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  color: #37352f;
  white-space: nowrap;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 0.12em;
}

.table-settings-action-card__name:hover {
  color: #111;
}

@media (max-width: 1100px) {
  .table-settings-inline-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .table-settings-inline-options,
  .table-settings-inline-options--features {
    grid-template-columns: 1fr;
  }

  .table-settings-inline-options__item--pair {
    grid-column: 1 / -1;
    grid-template-columns: 1fr;
  }
}
</style>

<style>
.table-settings-hint-tooltip,
.table-settings-hint-tooltip .p-tooltip-text {
  max-width: 18rem;
  white-space: normal;
  line-height: 1.4;
}
</style>
