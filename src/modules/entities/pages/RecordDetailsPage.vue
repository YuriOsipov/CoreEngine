<script lang="ts">
export default {
  name: 'RecordDetailsPage',
}
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch, watchEffect } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import FormRenderer from '../components/FormRenderer.vue'
import FormRendererLight from '../components/FormRendererLight.vue'
import RecordPageRenderer from '../components/RecordPageRenderer.vue'
import CrmNotFoundState from '@/core/ui-kit/CrmNotFoundState.vue'
import { isRecordNotFoundError } from '../utils/isRecordNotFoundError'
import type {
  EntityAction,
  EntityLayoutSchema,
  LayoutFieldMetadata,
  RecordPageComponent,
  RecordPageLayoutSchema,
} from '@/interfaces'
import { loadEntityLayoutById } from '@/modules/config/services/layoutSettings'
import { resolvePreferredBlockLayoutForCurrentUser } from '@/core/resolvePreferredBlockLayout'
import { collectionExistsInRegistry } from '../services/collectionSchema'
import {
  archiveObjectRecord,
  isRecordArchived,
  restoreObjectRecord,
  fetchObjectRecordForEdit,
  triggerFlowAction,
  updateObjectRecord,
} from '../services/recordDetails'
import { applyCloneRelatedAction } from '../services/cloneRelatedFromSource'
import { applyBulkUpdateRelatedAction } from '../services/bulkUpdateRelatedAction'
import { trackRecentRecordView } from '@/modules/dashboard/services/recentRecords'
import {
  useTranslation,
  useTranslatedCollection,
} from '@/core/translation'
import { useEntityPermissions } from '@/core/entityPermissions'
import { useRecordEditAccess } from '@/core/useRecordEditAccess'
import { renderTemplateLabel } from '../utils/recordDisplay'
import {
  fetchCollectionDisplayTemplate,
  fetchRelatedCollectionOptionById,
} from '../services/collectionSchema'
import { useFavoriteContext } from '@/core/navigation/useFavoriteContext'
import { buildChangedFormPayload } from '@/core/entityFormPayload'
import { createLayoutSchema } from '@/core/entityLayoutUtils'
import { collectPathLayoutExtraFields } from '@/core/recordPagePath'
import { prepareEntityFormDraft } from '@/core/entityFormValues'
import DocTemplatePickerDialog from '@/modules/documents/components/DocTemplatePickerDialog.vue'
import DocValueListDialog from '@/modules/documents/components/DocValueListDialog.vue'
import DocFillDialog from '@/modules/documents/components/DocFillDialog.vue'
import DocViewDialog from '@/modules/documents/components/DocViewDialog.vue'
import ActionNumberPromptDialog from '@/core/ui-kit/ActionNumberPromptDialog.vue'
import ApplyTemplateDialog from '@/modules/projects/components/ApplyTemplateDialog.vue'
import {
  loadDocTemplateByIdForCurrentUser,
  loadPublishedDocTemplateOptions,
} from '@/modules/documents/services/docTemplateService'
import { loadDocValueListItems } from '@/modules/documents/services/docValueService'
import type { DocTemplateOption, DocValueListItem } from '@/interfaces'
import {
  PM_PROJECT_COLLECTION,
  PM_PROJECT_TEMPLATE_COLLECTION,
} from '@/interfaces/projects'

const route = useRoute()
const router = useRouter()
const confirm = useConfirm()
const toast = useToast()
const { t } = useTranslation()
// Parse collection/id pairs from the current URL for arbitrary nesting depth.
// e.g. /object/patient/2/visit/47/lab_result/5
//      → [{collection:'patient',id:'2'},{collection:'visit',id:'47'},{collection:'lab_result',id:'5'}]
const pathPairs = computed((): Array<{ collection: string; id: string }> => {
  const stripped = route.path.replace(/^\/object\//, '')
  const parts = stripped.split('/')
  const pairs: Array<{ collection: string; id: string }> = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const collection = decodeURIComponent(parts[i])
    const id = decodeURIComponent(parts[i + 1])
    if (collection && id) pairs.push({ collection, id })
  }
  return pairs
})

const collectionName = computed(() => String(route.params.collection ?? ''))
const collectionLabel = useTranslatedCollection(() => collectionName.value)
const recordId = computed(() => String(route.params.id ?? ''))

// Display the LAST pair in the chain (may be same as root for a simple detail page).
const detailCollectionName = computed(() =>
  pathPairs.value[pathPairs.value.length - 1]?.collection || collectionName.value,
)
const detailCollectionLabel = useTranslatedCollection(() => detailCollectionName.value)
const {
  canDelete: canDeleteRecord,
  canRead: canReadRecord,
  ready: permissionsReady,
} = useEntityPermissions(() => detailCollectionName.value)
const detailRecordId = computed(() =>
  pathPairs.value[pathPairs.value.length - 1]?.id || recordId.value,
)
const { canEdit: canUpdateRecord } = useRecordEditAccess(
  () => detailCollectionName.value,
  () => detailRecordId.value,
)

const parentPathPair = computed(() =>
  pathPairs.value.length >= 2
    ? pathPairs.value[pathPairs.value.length - 2] ?? null
    : null,
)
const parentCollectionLabel = useTranslatedCollection(
  () => parentPathPair.value?.collection ?? '',
)
const parentDisplayLabel = ref('')

watch(
  parentPathPair,
  (parent) => {
    parentDisplayLabel.value = ''
    if (!parent) return
    const { collection, id } = parent
    void fetchRelatedCollectionOptionById(collection, id).then((option) => {
      if (
        parentPathPair.value?.collection !== collection ||
        parentPathPair.value?.id !== id
      ) {
        return
      }
      const label = option?.label != null ? String(option.label).trim() : ''
      parentDisplayLabel.value = label && label !== id ? label : id
    })
  },
  { immediate: true },
)

// Back route = the path without the last collection/id pair.
const backRoute = computed(() => {
  if (pathPairs.value.length >= 2) {
    const parentPairs = pathPairs.value.slice(0, -1)
    return '/object/' + parentPairs
      .map((p) => `${encodeURIComponent(p.collection)}/${encodeURIComponent(p.id)}`)
      .join('/')
  }
  return `/object/${collectionName.value}`
})

const backLabel = computed(() => {
  const parent = parentPathPair.value
  if (parent) {
    return t(
      'recordDetails.parentRecordBackLabel',
      '{collection} {id}',
      {
        collection: parentCollectionLabel.value || parent.collection,
        id: parentDisplayLabel.value || parent.id,
      },
    )
  }
  return collectionLabel.value
})
const layoutSchema = ref<EntityLayoutSchema | null>(null)
const pageLayoutSchema = ref<RecordPageLayoutSchema | null>(null)
const recordData = ref<Record<string, unknown>>({})
const deleting = ref(false)
const restoring = ref(false)
const editDraft = ref<Record<string, unknown>>({})
const editFormRendererRef = ref<{
  validateRequired: () => { valid: boolean; missingLabels: string[] }
} | null>(null)
const editOriginalRecord = ref<Record<string, unknown> | null>(null)
const editDialogVisible = ref(false)
const editSaving = ref(false)
const actionRunning = ref<Record<string, boolean>>({})
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)
const templatePickerVisible = ref(false)
const templatePickerLoading = ref(false)
const publishedTemplates = ref<DocTemplateOption[]>([])
const docValueListVisible = ref(false)
const docValueListLoading = ref(false)
const docValueListItems = ref<DocValueListItem[]>([])
const pendingDocumentAction = ref<EntityAction | null>(null)
const fillDialogVisible = ref(false)
const fillTemplateId = ref('')
const fillDocValueId = ref<string | null>(null)
const fillExportMode = ref<'html' | 'pdf'>('pdf')
const fillAttachFile = ref(true)
const viewDialogVisible = ref(false)
const viewTemplateId = ref('')
const viewDocValueId = ref<string | null>(null)
const viewMode = ref<'html' | 'pdf'>('html')
const viewAutoSave = ref(false)
const viewAttachFile = ref(false)
const numberPromptVisible = ref(false)
const numberPromptLabel = ref('')
const numberPromptHeader = ref('')
const pendingBulkAction = ref<EntityAction | null>(null)
const editError = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const recordMissing = ref(false)
const collectionMissing = ref(false)
const pathSaving = ref(false)
const recordActionsVisible = computed(
  () =>
    canReadRecord.value &&
    !recordMissing.value &&
    !collectionMissing.value &&
    !error.value &&
    Boolean(layoutSchema.value),
)
const listBackRoute = computed(
  () => `/object/${encodeURIComponent(detailCollectionName.value)}`,
)
const applyTemplateVisible = ref(false)
let loadToken = 0
const detailActions = ref<EntityAction[]>([])

const pageHasHighlightsComponent = computed(() => {
  if (!pageLayoutSchema.value) return false
  for (const region of pageLayoutSchema.value.regions) {
    let found = false
    walkPageComponents(region.components, (component) => {
      if (component.type === 'highlights') {
        found = true
        return true
      }
    })
    if (found) return true
  }
  return false
})

const isArchivedRecord = computed(() => isRecordArchived(recordData.value))
const stayOnProjectForm = computed(
  () => route.query.form === '1' || route.query.form === 'true',
)

watch(
  () =>
    [
      detailCollectionName.value,
      detailRecordId.value,
      pathPairs.value.length,
      stayOnProjectForm.value,
    ] as const,
  ([collection, id, depth, stay]) => {
    if (collection !== PM_PROJECT_COLLECTION || !id || depth !== 1 || stay) return
    void router.replace({
      name: 'project-workspace',
      params: { projectId: id },
      query: { view: 'gantt' },
    })
  },
  { immediate: true },
)

function walkPageComponents(
  components: RecordPageComponent[],
  visit: (component: RecordPageComponent) => boolean | void,
): boolean {
  for (const component of components) {
    if (visit(component) === true) return true
    if (component.type === 'fieldGroup' && component.components) {
      if (walkPageComponents(component.components, visit)) return true
    }
    if (component.tabs) {
      for (const tab of component.tabs) {
        if (walkPageComponents(tab.components, visit)) return true
      }
    }
  }
  return false
}

async function resolveDetailActions(
  pageLayout: RecordPageLayoutSchema | null,
  fallback: EntityLayoutSchema | null,
): Promise<EntityAction[]> {
  /** Explicit highlights/actions override only — do not fall back to pageLayoutId
   *  (that Setting often has stale/empty actions; Gen Visits lives on the Block Layout). */
  let explicitActionLayoutId: string | null = null
  let foundHighlights = false

  if (pageLayout) {
    for (const region of pageLayout.regions) {
      walkPageComponents(region.components, (component) => {
        if (component.type === 'highlights') {
          foundHighlights = true
          explicitActionLayoutId = component.actionLayoutId?.trim() || null
          return true
        }
      })
      if (foundHighlights) break
    }

    if (!foundHighlights) {
      for (const region of pageLayout.regions) {
        walkPageComponents(region.components, (component) => {
          if (component.type === 'actions') {
            explicitActionLayoutId = component.actionLayoutId?.trim() || null
            return true
          }
        })
        if (explicitActionLayoutId) break
      }
    }
  }

  if (explicitActionLayoutId) {
    const layout = await loadEntityLayoutById(
      pageLayout?.entity ?? fallback?.entity ?? '',
      explicitActionLayoutId,
    )
    if (layout?.actions?.length) return layout.actions
  }

  return fallback?.actions ?? []
}

const { setFavoriteContext, clearFavoriteContext } = useFavoriteContext()
const recordDisplayLabel = ref<string>('')

watchEffect(() => {
  const collection = detailCollectionName.value
  const id = detailRecordId.value
  const record = recordData.value
  if (!collection || !id || !Object.keys(record).length) return

  fetchCollectionDisplayTemplate(collection).then((template) => {
    const name = template
      ? renderTemplateLabel(template, record)
      : (String(record.id ?? id))
    recordDisplayLabel.value = name

    const label = `${detailCollectionLabel.value} · ${name}`
    setFavoriteContext({
      defaultLabel: label,
      target: { kind: 'url' as const, href: route.path, external: false },
    })
  })
})
onUnmounted(clearFavoriteContext)

const editLayoutSchema = computed<EntityLayoutSchema | null>(() => {
  if (!layoutSchema.value) return null
  return createLayoutSchema(layoutSchema.value)
})

watch(
  [detailCollectionName, detailRecordId, permissionsReady, canReadRecord],
  ([collection, id, ready, canRead]) => {
    if (!collection || !id || !ready) return
    void (async () => {
      collectionMissing.value = false
      recordMissing.value = false
      const exists = await collectionExistsInRegistry(collection)
      if (detailCollectionName.value !== collection || detailRecordId.value !== id) return
      if (!exists) {
        collectionMissing.value = true
        recordData.value = {}
        layoutSchema.value = null
        error.value = null
        loading.value = false
        return
      }
      if (!canRead) {
        recordData.value = {}
        layoutSchema.value = null
        loading.value = false
        error.value = null
        return
      }
      void loadRecordDetails(collection, id)
    })()
  },
  { immediate: true },
)

async function loadRecordDetails(collection: string, id: string): Promise<void> {
  const token = ++loadToken
  loading.value = true
  error.value = null
  recordMissing.value = false
  collectionMissing.value = false
  layoutSchema.value = null
  pageLayoutSchema.value = null
  detailActions.value = []
  recordData.value = {}
  editDialogVisible.value = false
  editError.value = null
  try {
    if (!(await collectionExistsInRegistry(collection))) {
      if (token !== loadToken) return
      collectionMissing.value = true
      return
    }

    const { pageLayout, blockLayout: schema } = await resolvePreferredBlockLayoutForCurrentUser(
      collection,
    )
    if (token !== loadToken) return

    if (!schema && !pageLayout) {
      error.value = t(
        'recordDetails.noSavedDetailLayout',
        'No saved detail layout found for "{collection}".',
        { collection: detailCollectionLabel.value },
      )
      return
    }

    if (!schema) {
      error.value = t(
        'recordDetails.noSavedBlockLayout',
        'Page Layout is configured, but no Block Layout was found for "{collection}".',
        { collection: detailCollectionLabel.value },
      )
      return
    }

    const record = await fetchObjectRecordForEdit(
      collection,
      id,
      schema,
      collectPathLayoutExtraFields(pageLayout),
    )
    if (token !== loadToken) return

    layoutSchema.value = schema
    pageLayoutSchema.value = pageLayout
    recordData.value = record
    detailActions.value = await resolveDetailActions(pageLayout, schema)
    void trackRecentRecordView(collection, id, record)
  } catch (err) {
    if (token !== loadToken) return
    if (isRecordNotFoundError(err)) {
      recordMissing.value = true
      error.value = null
      return
    }
    error.value =
      err instanceof Error
        ? err.message
        : t('recordDetails.failedLoad', 'Failed to load record details.')
  } finally {
    if (token === loadToken) {
      loading.value = false
    }
  }
}

async function openEditDialog(): Promise<void> {
  if (!editLayoutSchema.value) return
  try {
    const recordForEdit = await fetchObjectRecordForEdit(
      detailCollectionName.value,
      detailRecordId.value,
      editLayoutSchema.value,
    )
    editDraft.value = await prepareEntityFormDraft(
      detailCollectionName.value,
      editLayoutSchema.value,
      cloneRecord(recordForEdit),
      recordForEdit,
    )
    editOriginalRecord.value = cloneRecord(recordForEdit)
    editError.value = null
    editDialogVisible.value = true
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('recordDetails.failedLoad', 'Failed to load record details.'),
      life: 6000,
    })
  }
}

function updateEditDialogVisible(visible: boolean): void {
  if (editSaving.value && !visible) return
  editDialogVisible.value = visible
  if (!visible) {
    editError.value = null
    editOriginalRecord.value = null
  }
}

function closeEditDialog(): void {
  if (editSaving.value) return
  editDialogVisible.value = false
  editError.value = null
  editOriginalRecord.value = null
}

async function saveEditDialog(): Promise<void> {
  if (!editLayoutSchema.value || !editOriginalRecord.value) return

  const validation = editFormRendererRef.value?.validateRequired()
  if (validation && !validation.valid) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail: t('formRenderer.missingRequiredFields', 'Required fields are missing: {fields}', {
        fields: validation.missingLabels.join(', '),
      }),
      life: 5000,
    })
    return
  }

  editSaving.value = true
  editError.value = null

  try {
    const payload = await buildChangedFormPayload(
      detailCollectionName.value,
      editLayoutSchema.value,
      editDraft.value,
      editOriginalRecord.value,
    )

    if (Object.keys(payload).length === 0) {
      editDialogVisible.value = false
      editOriginalRecord.value = null
      return
    }

    const updated = await updateObjectRecord(
      detailCollectionName.value,
      detailRecordId.value,
      payload,
    )

    recordData.value = updated
    editDialogVisible.value = false
    editOriginalRecord.value = null
    await loadRecordDetails(detailCollectionName.value, detailRecordId.value)
  } catch (err) {
    editError.value =
      err instanceof Error
        ? err.message
        : t('datatable.saveRecordError', 'Failed to save record.')
  } finally {
    editSaving.value = false
  }
}

function deleteCurrentRecord(): void {
  if (isArchivedRecord.value) {
    restoreCurrentRecord()
    return
  }
  setTimeout(() => {
    confirm.require({
      message: t('datatable.confirmDeleteMessage', 'Delete this record?'),
      header: t('datatable.confirmDeleteHeader', 'Confirm Delete'),
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
        void archiveCurrentRecordConfirmed()
      },
    })
  }, 0)
}

function restoreCurrentRecord(): void {
  setTimeout(() => {
    confirm.require({
      message: t('datatable.confirmRestoreMessage', 'Restore this record?'),
      header: t('datatable.confirmRestoreHeader', 'Confirm Restore'),
      rejectProps: {
        label: t('common.cancel', 'Cancel'),
        severity: 'secondary',
        text: true,
      },
      acceptProps: {
        label: t('common.restore', 'Restore'),
      },
      accept: () => {
        void restoreCurrentRecordConfirmed()
      },
    })
  }, 0)
}

async function archiveCurrentRecordConfirmed(): Promise<void> {
  deleting.value = true
  actionError.value = null

  try {
    await archiveObjectRecord(detailCollectionName.value, detailRecordId.value)
    await router.push(backRoute.value)
  } catch (err) {
    actionError.value =
      err instanceof Error
        ? err.message
        : t('datatable.deleteError', 'Failed to delete record.')
  } finally {
    deleting.value = false
  }
}

async function restoreCurrentRecordConfirmed(): Promise<void> {
  restoring.value = true
  actionError.value = null

  try {
    const restored = await restoreObjectRecord(
      detailCollectionName.value,
      detailRecordId.value,
    )
    recordData.value = { ...recordData.value, ...restored, is_deleted: false }
  } catch (err) {
    actionError.value =
      err instanceof Error
        ? err.message
        : t('datatable.restoreError', 'Failed to restore record.')
  } finally {
    restoring.value = false
  }
}

function confirmBeforeRunForAction(action: EntityAction): boolean {
  if (action.behavior === 'cloneRelated') {
    return action.cloneRelated?.confirmBeforeRun !== false
  }
  if (action.behavior === 'bulkUpdateRelated') {
    return action.bulkUpdateRelated?.confirmBeforeRun !== false
  }
  return action.flow?.confirmBeforeRun !== false
}

function openBulkUpdatePrompt(action: EntityAction): void {
  pendingBulkAction.value = action
  numberPromptHeader.value = action.label
  numberPromptLabel.value =
    action.bulkUpdateRelated?.promptLabel?.trim()
    || t('recordDetails.actionPromptMultiplier', 'Multiplier')
  numberPromptVisible.value = true
}

function confirmOrRunBulkUpdate(action: EntityAction, multiplier: number): void {
  if (!confirmBeforeRunForAction(action)) {
    void runEntityActionConfirmed(action, multiplier)
    return
  }

  setTimeout(() => {
    confirm.require({
      message: t('recordDetails.confirmActionMessage', 'Run "{label}"?', {
        label: action.label,
      }),
      header: t('recordDetails.confirmActionHeader', 'Confirm Action'),
      rejectProps: {
        label: t('common.cancel', 'Cancel'),
        severity: 'secondary',
        text: true,
      },
      acceptProps: {
        label: t('recordDetails.runAction', 'Run'),
      },
      accept: () => {
        void runEntityActionConfirmed(action, multiplier)
      },
    })
  }, 0)
}

function startBulkUpdateRelated(action: EntityAction): void {
  const promptLabel = action.bulkUpdateRelated?.promptLabel?.trim() ?? ''
  if (!promptLabel) {
    // No prompt configured — skip number dialog; {{prompt}} unused formulas ignore this.
    confirmOrRunBulkUpdate(action, 0)
    return
  }
  openBulkUpdatePrompt(action)
}

function onNumberPromptConfirm(multiplier: number): void {
  const action = pendingBulkAction.value
  pendingBulkAction.value = null
  if (!action) return
  confirmOrRunBulkUpdate(action, multiplier)
}

function runEntityAction(action: EntityAction): void {
  if (actionRunning.value[action.id]) return

  if (action.behavior === 'openDocument' || action.displayType === 'document') {
    void openDocumentAction(action)
    return
  }

  if (action.behavior === 'bulkUpdateRelated') {
    startBulkUpdateRelated(action)
    return
  }

  if (!confirmBeforeRunForAction(action)) {
    void runEntityActionConfirmed(action)
    return
  }

  setTimeout(() => {
    confirm.require({
      message: t('recordDetails.confirmActionMessage', 'Run "{label}"?', {
        label: action.label,
      }),
      header: t('recordDetails.confirmActionHeader', 'Confirm Action'),
      rejectProps: {
        label: t('common.cancel', 'Cancel'),
        severity: 'secondary',
        text: true,
      },
      acceptProps: {
        label: t('recordDetails.runAction', 'Run'),
      },
      accept: () => {
        void runEntityActionConfirmed(action)
      },
    })
  }, 0)
}

function navigateToDocumentFill(
  selectedTemplateId: string,
  docValueId?: string | null,
  exportMode: 'html' | 'pdf' = 'pdf',
): void {
  fillTemplateId.value = selectedTemplateId
  fillDocValueId.value = docValueId ?? null
  fillExportMode.value = exportMode === 'html' ? 'html' : 'pdf'
  fillAttachFile.value = true
  fillDialogVisible.value = true

  void loadDocTemplateByIdForCurrentUser(selectedTemplateId).then((tmpl) => {
    if (!tmpl || fillTemplateId.value !== selectedTemplateId) return
    fillAttachFile.value = tmpl.attach_file !== false
  })
}

function openDocumentView(
  action: EntityAction,
  selectedTemplateId: string,
  docValueId?: string | null,
): void {
  viewTemplateId.value = selectedTemplateId
  viewDocValueId.value = docValueId ?? null
  viewMode.value = action.document?.viewMode === 'pdf' ? 'pdf' : 'html'
  viewAutoSave.value = action.document?.autoSave === true
  viewAttachFile.value = action.document?.attachFile === true
  viewDialogVisible.value = true
}

function navigateToDocument(
  action: EntityAction,
  selectedTemplateId: string,
  docValueId?: string | null,
): void {
  if (action.document?.skipInteractiveFill) {
    openDocumentView(action, selectedTemplateId, docValueId)
    return
  }
  navigateToDocumentFill(
    selectedTemplateId,
    docValueId,
    action.document?.viewMode === 'html' ? 'html' : 'pdf',
  )
}

async function openTemplatePickerForNewDocument(
  action: EntityAction,
): Promise<void> {
  const configuredTemplateId = action.document?.templateId?.trim() || null
  if (configuredTemplateId) {
    const template = await loadDocTemplateByIdForCurrentUser(configuredTemplateId)
    if (!template) {
      actionError.value = t(
        'documents.templateAccessDenied',
        'You do not have access to this document template.',
      )
      return
    }
    navigateToDocument(action, configuredTemplateId)
    return
  }

  pendingDocumentAction.value = action
  templatePickerLoading.value = true
  templatePickerVisible.value = true
  actionError.value = null

  try {
    publishedTemplates.value = await loadPublishedDocTemplateOptions(
      detailCollectionName.value,
    )
    if (publishedTemplates.value.length === 0) {
      actionError.value = t(
        'documents.noTemplates',
        'No document templates are available for this collection.',
      )
      templatePickerVisible.value = false
    }
  } catch (err) {
    actionError.value =
      err instanceof Error
        ? err.message
        : t('documents.loadTemplatesError', 'Failed to load document templates.')
    templatePickerVisible.value = false
  } finally {
    templatePickerLoading.value = false
  }
}

async function openDocumentAction(action: EntityAction): Promise<void> {
  actionError.value = null
  pendingDocumentAction.value = action

  const configuredTemplateId = action.document?.templateId?.trim() || null

  docValueListLoading.value = true
  try {
    const existingDocuments = await loadDocValueListItems(
      detailCollectionName.value,
      detailRecordId.value,
      configuredTemplateId,
    )

    if (existingDocuments.length === 0) {
      await openTemplatePickerForNewDocument(action)
      return
    }

    docValueListItems.value = existingDocuments
    docValueListVisible.value = true
  } catch (err) {
    actionError.value =
      err instanceof Error
        ? err.message
        : t('documents.loadDocumentsError', 'Failed to load documents.')
  } finally {
    docValueListLoading.value = false
  }
}

function onExistingDocumentSelected(
  docValueId: string,
  selectedTemplateId: string,
): void {
  const action = pendingDocumentAction.value
  if (action) {
    navigateToDocument(action, selectedTemplateId, docValueId)
    return
  }
  navigateToDocumentFill(selectedTemplateId, docValueId)
}

function onNewDocumentFromList(): void {
  const action = pendingDocumentAction.value
  if (!action) return
  void openTemplatePickerForNewDocument(action)
}

function onRuntimeTemplateSelected(templateId: string): void {
  const action = pendingDocumentAction.value
  if (action) {
    navigateToDocument(action, templateId)
    return
  }
  navigateToDocumentFill(templateId)
}

async function runEntityActionConfirmed(
  action: EntityAction,
  multiplier?: number,
): Promise<void> {
  if (actionRunning.value[action.id]) return

  actionRunning.value = { ...actionRunning.value, [action.id]: true }
  actionMessage.value = null
  actionError.value = null

  try {
    if (action.behavior === 'cloneRelated') {
      const result = await applyCloneRelatedAction(
        action,
        detailCollectionName.value,
        recordData.value,
      )
      const successMessage = action.cloneRelated?.successMessage?.trim()
      actionMessage.value =
        successMessage ||
        t('recordDetails.cloneStructureCompletedCount', 'Created {count} record(s).', {
          count: result.created,
        })
      if (action.cloneRelated?.refreshRecordAfterRun !== false) {
        await loadRecordDetails(detailCollectionName.value, detailRecordId.value)
      }
    } else if (action.behavior === 'bulkUpdateRelated') {
      if (multiplier == null || !Number.isFinite(multiplier)) {
        throw new Error(
          t('recordDetails.actionPromptRequired', 'Enter a numeric value to continue.'),
        )
      }
      const result = await applyBulkUpdateRelatedAction(
        action,
        detailCollectionName.value,
        detailRecordId.value,
        multiplier,
      )
      const created = result.createdCount ?? 0
      const successMessage =
        action.bulkUpdateRelated?.successMessage?.trim()
        || (created > 0
          ? t(
            'recordDetails.bulkUpdateRelatedCompletedCountWithCreate',
            'Created {created}, updated {updated}; skipped {skipped}.',
            {
              created,
              updated: result.updatedCount,
              skipped: result.skippedCount,
            },
          )
          : t(
            'recordDetails.bulkUpdateRelatedCompletedCount',
            'Updated {updated} record(s); skipped {skipped}.',
            { updated: result.updatedCount, skipped: result.skippedCount },
          ))
      actionMessage.value = successMessage
      toast.add({
        severity: 'success',
        summary: t('common.success', 'Success'),
        detail: successMessage,
        life: 4000,
      })
      if (action.bulkUpdateRelated?.refreshRecordAfterRun !== false) {
        await loadRecordDetails(detailCollectionName.value, detailRecordId.value)
      }
    } else {
      await triggerFlowAction(
        action,
        detailCollectionName.value,
        detailRecordId.value,
        recordData.value,
      )
      const successMessage = action.flow?.successMessage?.trim()
      actionMessage.value =
        successMessage && successMessage !== 'Action completed.'
          ? successMessage
          : t('recordDetails.actionCompleted', 'Action completed.')
      if (action.flow?.refreshRecordAfterRun !== false) {
        await loadRecordDetails(detailCollectionName.value, detailRecordId.value)
      }
    }
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : t('recordDetails.failedRunAction', 'Failed to run "{label}".', {
          label: action.label,
        })
    actionError.value = message
    if (action.behavior === 'bulkUpdateRelated') {
      toast.add({
        severity: 'error',
        summary: t('common.error', 'Error'),
        detail: message,
        life: 5000,
      })
    }
  } finally {
    actionRunning.value = { ...actionRunning.value, [action.id]: false }
  }
}

async function handleBlocksSaved(payload: { field: string; value: unknown }): Promise<void> {
  recordData.value = {
    ...recordData.value,
    [payload.field]: payload.value,
  }
}

/** Path stage/outcome + readonly-if fields may live only on the Page Layout. */
function pathLayoutExtraFields(): LayoutFieldMetadata[] {
  return collectPathLayoutExtraFields(pageLayoutSchema.value)
}

async function handlePathChange(payload: {
  updates: Record<string, unknown>
}): Promise<void> {
  if (
    pathSaving.value
    || loading.value
    || deleting.value
    || restoring.value
    || isArchivedRecord.value
    || !canUpdateRecord.value
  ) {
    return
  }

  const updates = payload.updates
  if (!updates || typeof updates !== 'object') return

  const changed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(updates)) {
    const field = key.trim()
    if (!field) continue
    const current = recordData.value[field]
    const same =
      (current === null || current === undefined || current === '')
      && (value === null || value === undefined || value === '')
        ? true
        : String(current ?? '') === String(value ?? '')
    if (!same) changed[field] = value
  }
  if (Object.keys(changed).length === 0) return

  pathSaving.value = true
  try {
    await updateObjectRecord(
      detailCollectionName.value,
      detailRecordId.value,
      changed,
    )
    // Re-fetch with layout fields so System (user_updated / date_updated) and
    // expanded relations stay complete — update payloads omit nested audit users.
    // Merge `changed` afterward: Path stage/outcome may not be on the Block Layout,
    // so a layout-only re-fetch would drop them and undo Closed Status in the UI.
    if (layoutSchema.value) {
      const refreshed = await fetchObjectRecordForEdit(
        detailCollectionName.value,
        detailRecordId.value,
        layoutSchema.value,
        pathLayoutExtraFields(),
      )
      recordData.value = { ...refreshed, ...changed }
    } else {
      recordData.value = { ...recordData.value, ...changed }
    }
    toast.add({
      severity: 'success',
      summary: t('common.success', 'Success'),
      detail: t('recordPage.path.stageChanged', 'Stage changed successfully.'),
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: t('common.error', 'Error'),
      detail:
        err instanceof Error
          ? err.message
          : t('recordPage.path.saveError', 'Failed to update stage.'),
      life: 5000,
    })
  } finally {
    pathSaving.value = false
  }
}

async function handleRelatedChanged(): Promise<void> {
  if (!layoutSchema.value) return
  try {
    const record = await fetchObjectRecordForEdit(
      detailCollectionName.value,
      detailRecordId.value,
      layoutSchema.value,
    )
    recordData.value = record
  } catch {
    // Keep the current record if the silent rollup refresh fails.
  }
}

function onProjectTemplateApplied(projectId: string): void {
  applyTemplateVisible.value = false
  void router.push({
    name: 'project-workspace',
    params: { projectId },
    query: { view: 'gantt' },
  })
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>
}
</script>

<template>
  <main class="app-shell app-shell--record-details">
    <header class="app-header app-header--integrated record-details-header">
      <div class="app-header__nav-row">
        <RouterLink :to="backRoute" class="nav-link record-details-header__back">
          {{ t('recordDetails.backTo', 'Back to {label}', { label: backLabel }) }}
        </RouterLink>
        <div v-if="recordActionsVisible" class="app-header-actions">
          <div
            v-if="detailCollectionName === 'patient' || detailCollectionName === 'pm_project_template' || detailCollectionName === PM_PROJECT_COLLECTION"
            class="app-header-actions__group"
          >
            <Button
              v-if="detailCollectionName === 'patient'"
              :label="t('projects.openProjects', 'Projects')"
              size="small"
              severity="secondary"
              outlined
              icon="pi pi-sitemap"
              :disabled="loading"
              @click="
                router.push({
                  name: 'object-list',
                  params: { collection: PM_PROJECT_COLLECTION },
                  query: { patient: detailRecordId },
                })
              "
            />
            <Button
              v-if="detailCollectionName === PM_PROJECT_COLLECTION"
              :label="t('projects.viewGantt', 'Gantt')"
              size="small"
              icon="pi pi-chart-bar"
              :disabled="loading"
              @click="
                router.push({
                  name: 'project-workspace',
                  params: { projectId: detailRecordId },
                  query: { view: 'gantt' },
                })
              "
            />
            <Button
              v-if="detailCollectionName !== PM_PROJECT_COLLECTION"
              :label="t('projects.applyTemplate', 'Apply project template')"
              size="small"
              icon="pi pi-copy"
              :disabled="loading"
              @click="applyTemplateVisible = true"
            />
          </div>
          <template v-if="!pageHasHighlightsComponent">
            <div class="app-header-actions__group">
              <Button
                v-if="canUpdateRecord"
                :label="t('common.edit', 'Edit')"
                size="small"
                :disabled="loading || deleting || !layoutSchema"
                @click="openEditDialog"
              />
              <Button
                v-if="canDeleteRecord"
                :label="
                  isArchivedRecord
                    ? t('common.restore', 'Restore')
                    : t('common.delete', 'Delete')
                "
                size="small"
                :severity="isArchivedRecord ? undefined : 'danger'"
                :loading="deleting || restoring"
                :disabled="loading || !layoutSchema"
                @click="deleteCurrentRecord"
              />
            </div>
            <div
              v-if="detailActions.length > 0"
              class="app-header-actions__group app-header-actions__group--bordered"
            >
              <Button
                v-for="action in detailActions"
                :key="action.id"
                :label="action.label"
                size="small"
                :loading="actionRunning[action.id]"
                :disabled="loading || deleting || !layoutSchema"
                @click="runEntityAction(action)"
              />
            </div>
          </template>
        </div>
      </div>
    </header>

    <section class="object-details-pane">
      <div v-if="!permissionsReady" class="page-loading object-details-pane__state">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('permissions.checkingAccess', 'Checking access...') }}</span>
      </div>

      <CrmNotFoundState
        v-else-if="collectionMissing"
        class="object-details-pane__state"
        :title="t('objectList.notFoundTitle', 'Object not found')"
        :detail="
          t(
            'objectList.notFoundDetail',
            'There is no object named {collection}.',
            { collection: detailCollectionName },
          )
        "
        :back-label="t('app.backHome', 'Back to home')"
        back-to="/"
      />

      <Message
        v-else-if="!canReadRecord"
        severity="warn"
        :closable="false"
        class="collections-message object-details-pane__state"
      >
        {{
          t(
            'permissions.noReadAccess',
            'You do not have permission to view {collection}.',
            { collection: detailCollectionLabel || detailCollectionName },
          )
        }}
      </Message>

      <div v-else-if="loading" class="page-loading object-details-pane__state">
        <ProgressSpinner stroke-width="4" />
        <span>{{ t('recordDetails.loading', 'Loading record details...') }}</span>
      </div>

      <CrmNotFoundState
        v-else-if="recordMissing"
        class="object-details-pane__state"
        :title="t('recordDetails.notFoundTitle', 'Record not found')"
        :detail="
          t(
            'recordDetails.notFoundDetail',
            'This {collection} record does not exist or is no longer available.',
            { collection: detailCollectionLabel || detailCollectionName },
          )
        "
        :back-label="
          t('recordDetails.backToList', 'Back to {collection}', {
            collection: detailCollectionLabel || detailCollectionName,
          })
        "
        :back-to="listBackRoute"
      />

      <Message
        v-else-if="error"
        severity="error"
        :closable="false"
        class="collections-message object-details-pane__state"
      >
        {{ error }}
      </Message>

      <template v-else>
        <div
          v-if="actionError || actionMessage"
          class="object-details-pane__alerts"
        >
          <Message
            v-if="actionError"
            severity="error"
            :closable="false"
            class="collections-message"
          >
            {{ actionError }}
          </Message>

          <Message
            v-if="actionMessage"
            severity="success"
            :closable="false"
            class="collections-message"
          >
            {{ actionMessage }}
          </Message>
        </div>

        <RecordPageRenderer
          v-if="pageLayoutSchema && layoutSchema"
          :page-layout="pageLayoutSchema"
          :default-block-layout="layoutSchema"
          :model-value="recordData"
          :collection="detailCollectionName"
          :record-id="detailRecordId"
          :m2a-editable="true"
          :actions="detailActions"
          :action-running="actionRunning"
          :actions-disabled="loading || deleting || restoring || pathSaving || !layoutSchema"
          :deleting="deleting || restoring"
          :record-archived="isArchivedRecord"
          :path-saving="pathSaving"
          @blocks-saved="handleBlocksSaved"
          @path-change="handlePathChange"
          @related-changed="handleRelatedChanged"
          @run-action="runEntityAction"
          @edit-record="openEditDialog"
          @delete-record="deleteCurrentRecord"
        />

        <div
          v-else-if="layoutSchema"
          class="object-details-pane__fallback"
        >
          <FormRendererLight
            :schema="layoutSchema"
            :model-value="recordData"
            :parent-id="detailRecordId"
            :parent-name="detailCollectionName"
            :m2a-editable="true"
            @blocks-saved="handleBlocksSaved"
            @related-changed="handleRelatedChanged"
          />
        </div>
      </template>
    </section>

    <Dialog
      :visible="editDialogVisible"
      modal
      :header="t('recordDetails.editDialogHeader', 'Edit Record Details')"
      class="record-edit-dialog"
      :style="{ width: 'min(960px, 95vw)' }"
      @update:visible="updateEditDialogVisible"
      @hide="closeEditDialog"
    >
      <Message
        v-if="editError"
        severity="error"
        :closable="false"
        class="collections-message"
      >
        {{ editError }}
      </Message>

      <FormRenderer
        v-if="editLayoutSchema"
        ref="editFormRendererRef"
        v-model="editDraft"
        :schema="editLayoutSchema"
        :record-id="detailRecordId"
      />

      <template #footer>
        <Button
          :label="t('common.cancel', 'Cancel')"
          severity="secondary"
          text
          :disabled="editSaving"
          @click="closeEditDialog"
        />
        <Button
          :label="t('common.save', 'Save')"
          :loading="editSaving"
          @click="saveEditDialog"
        />
      </template>
    </Dialog>

    <ApplyTemplateDialog
      v-model:visible="applyTemplateVisible"
      :patient-id="detailCollectionName === 'patient' ? detailRecordId : null"
      :preset-template-id="
        detailCollectionName === PM_PROJECT_TEMPLATE_COLLECTION ? detailRecordId : null
      "
      @applied="onProjectTemplateApplied"
    />

    <DocTemplatePickerDialog
      v-model:visible="templatePickerVisible"
      :templates="publishedTemplates"
      :loading="templatePickerLoading"
      @select="onRuntimeTemplateSelected"
    />

    <DocValueListDialog
      v-model:visible="docValueListVisible"
      :documents="docValueListItems"
      :loading="docValueListLoading"
      @select="onExistingDocumentSelected"
      @new-document="onNewDocumentFromList"
    />

    <DocFillDialog
      v-if="fillTemplateId"
      v-model:visible="fillDialogVisible"
      :collection="detailCollectionName"
      :record-id="detailRecordId"
      :template-id="fillTemplateId"
      :doc-value-id="fillDocValueId"
      :export-mode="fillExportMode"
      :attach-file="fillAttachFile"
    />

    <DocViewDialog
      v-if="viewTemplateId"
      v-model:visible="viewDialogVisible"
      :collection="detailCollectionName"
      :record-id="detailRecordId"
      :template-id="viewTemplateId"
      :doc-value-id="viewDocValueId"
      :view-mode="viewMode"
      :auto-save="viewAutoSave"
      :attach-file="viewAttachFile"
      @attached="() => void loadRecordDetails(detailCollectionName, detailRecordId)"
    />

    <ActionNumberPromptDialog
      v-model:visible="numberPromptVisible"
      :header="numberPromptHeader"
      :label="numberPromptLabel"
      @confirm="onNumberPromptConfirm"
    />
  </main>
</template>

