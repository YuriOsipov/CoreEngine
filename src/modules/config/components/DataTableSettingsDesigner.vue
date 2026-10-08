<script lang="ts">
export default {
  name: 'DataTableSettingsDesigner',
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VueDraggableNext } from 'vue-draggable-next'
import type {
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
import { listDataTableFields, normalizeTableSettings, DEFAULT_RELATED_ROW_LIMIT } from '@/modules/entities/services/tableSettings'
import {
  getCachedCollectionFields,
  getCachedRelations,
} from '@/modules/entities/services/collectionSchema'
import { loadDocTemplateListItems } from '@/modules/documents/services/docTemplateService'
import { buildListFilterMetaBlock } from '@/core/listFilterUtils'
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
    fieldWidth?: number
  }> | null
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
const sortOptions = computed(() => [
  { label: t('tableSettings.noDefaultSort', 'No default sort'), value: '' },
  ...selectedColumns.value.map((field) => ({
    label: field.header,
    value: field.field,
  })),
])
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

const viewModeOptions = computed(() => [
  { label: t('formBuilder.documentViewPdf', 'PDF'), value: 'pdf' as const },
  { label: t('formBuilder.documentViewHtml', 'HTML'), value: 'html' as const },
])

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

function createEmptyListAction(): ListViewAction {
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

function openAddListAction(): void {
  editingActionId.value = null
  actionDraft.value = createEmptyListAction()
  actionDraftVisible.value = true
}

function openEditListAction(action: ListViewAction): void {
  editingActionId.value = action.id
  actionDraft.value = {
    ...action,
    document: { ...action.document },
  }
  actionDraftVisible.value = true
}

function removeListAction(actionId: string): void {
  listActions.value = listActions.value.filter((action) => action.id !== actionId)
}

function applyListActionDraft(): void {
  const draft = actionDraft.value
  if (!draft) return
  const label = draft.label.trim()
  if (!label || !draft.document.templateId?.trim()) return

  const next: ListViewAction = {
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

function templateLabelForAction(action: ListViewAction): string {
  const id = action.document.templateId
  if (!id) return t('tableSettings.listActionNoTemplate', 'No template')
  return docTemplateOptions.value.find((opt) => opt.value === id)?.label ?? id
}

async function openListActionTemplate(action: ListViewAction): Promise<void> {
  const templateId = action.document.templateId?.trim()
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

  const filterConditions = props.listViewConditions?.length
    ? props.listViewConditions.map((condition) => ({ ...condition }))
    : null
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
                'Adds a toolbar button that builds one DocEngine document from list rows ($payload.records). Map table columns to $payload.records.* in the template.',
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
                  v-if="action.document.templateId?.trim()"
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
              @click="openAddListAction"
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
        class="table-settings-designer__panels min-h-0 flex-1 overflow-hidden"
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
          <div class="table-settings-panel__body min-h-0 overflow-y-auto overscroll-contain">
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
            class="table-settings-panel__body flex min-h-0 flex-col gap-[0.35rem] overflow-y-auto overscroll-contain"
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

        <div class="table-settings-inline-options__item">
          <label class="table-settings-inline-options__label">{{ t('tableSettings.defaultSort', 'Default sort') }}</label>
          <div class="flex items-center gap-2 min-w-0">
            <Select
              v-model="sortField"
              class="flex-1 min-w-0"
              :options="sortOptions"
              option-label="label"
              option-value="value"
              :placeholder="t('tableSettings.sortField', 'Sort field')"
            />
            <Select
              v-model="sortOrder"
              class="w-[8.5rem] flex-shrink-0"
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

        <div class="table-settings-inline-options__item">
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
          class="table-settings-inline-options__item"
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
              {{ t('formBuilder.documentTemplate', 'Document template') }}
            </label>
            <Select
              v-model="actionDraft.document.templateId"
              :options="docTemplateOptions"
              option-label="label"
              option-value="value"
              :placeholder="t('formBuilder.documentTemplateRuntime', 'Choose template')"
              fluid
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
            :disabled="!actionDraft?.label?.trim() || !actionDraft?.document?.templateId"
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
  width: 100%;
  min-height: 12rem;
  border: 0;
  background: transparent;
}

.table-settings-designer__panels :deep(.p-splitter-panel) {
  display: flex;
  min-width: 0;
  overflow: hidden;
}

.table-settings-designer__split-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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

.table-settings-panel__empty {
  font-size: 0.85rem;
  color: rgba(55, 53, 47, 0.45);
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
  gap: 0.45rem 0.75rem;
  align-items: end;
  border-radius: 8px;
  background: var(--list-wash);
  padding: 0.5rem;
}

.table-settings-inline-options--features {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
}

.table-settings-inline-options__item {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
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
