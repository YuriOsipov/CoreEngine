import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'openvue/useconfirm'
import type { EntityAction } from '@/interfaces'
import { triggerFlowAction } from '@/modules/entities/services/recordDetails'
import { applyCloneRelatedAction } from '@/modules/entities/services/cloneRelatedFromSource'
import {
  loadDocTemplateByIdForCurrentUser,
  loadPublishedDocTemplateOptions,
} from '@/modules/documents/services/docTemplateService'
import { loadDocValueListItems } from '@/modules/documents/services/docValueService'
import type { DocEngineExportMode, DocTemplateOption, DocValueListItem } from '@/interfaces'
import { useTranslation } from '@/core/translation'

export function useEntityRecordActions(options: {
  collection: () => string
  recordId: () => string
  record: () => Record<string, unknown>
  onRefresh?: () => void | Promise<void>
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const { t } = useTranslation()

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
  const fillExportMode = ref<DocEngineExportMode>('pdf')
  const fillAttachFile = ref(true)

  const collection = computed(() => options.collection())
  const recordId = computed(() => options.recordId())

  function runEntityAction(action: EntityAction): void {
    if (actionRunning.value[action.id]) return
    if (!collection.value || !recordId.value) return

    if (action.behavior === 'openDocument' || action.displayType === 'document') {
      void openDocumentAction(action)
      return
    }

    const confirmBeforeRun =
      action.behavior === 'cloneRelated'
        ? action.cloneRelated?.confirmBeforeRun !== false
        : action.flow?.confirmBeforeRun !== false

    if (!confirmBeforeRun) {
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

  function openDocumentFill(
    selectedTemplateId: string,
    docValueId?: string | null,
    exportMode: DocEngineExportMode = 'pdf',
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

  function navigateToDocumentView(
    action: EntityAction,
    selectedTemplateId: string,
    docValueId?: string | null,
  ): void {
    void router.push({
      name: 'document-view',
      params: {
        collection: collection.value,
        id: recordId.value,
      },
      query: {
        template: selectedTemplateId,
        mode: action.document?.viewMode === 'pdf' ? 'pdf' : 'html',
        ...(docValueId ? { docValue: docValueId } : {}),
        ...(action.document?.autoSave ? { autoSave: '1' } : {}),
      },
    })
  }

  function navigateToDocument(
    action: EntityAction,
    selectedTemplateId: string,
    docValueId?: string | null,
  ): void {
    if (action.document?.skipInteractiveFill) {
      navigateToDocumentView(action, selectedTemplateId, docValueId)
      return
    }
    openDocumentFill(
      selectedTemplateId,
      docValueId,
      action.document?.viewMode === 'html' ? 'html' : 'pdf',
    )
  }

  async function openTemplatePickerForNewDocument(action: EntityAction): Promise<void> {
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
      publishedTemplates.value = await loadPublishedDocTemplateOptions(collection.value)
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
        collection.value,
        recordId.value,
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
    openDocumentFill(selectedTemplateId, docValueId)
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
    openDocumentFill(templateId)
  }

  async function runEntityActionConfirmed(action: EntityAction): Promise<void> {
    if (actionRunning.value[action.id]) return

    actionRunning.value = { ...actionRunning.value, [action.id]: true }
    actionMessage.value = null
    actionError.value = null

    try {
      if (action.behavior === 'cloneRelated') {
        const result = await applyCloneRelatedAction(action, collection.value, options.record())
        actionMessage.value =
          action.cloneRelated?.successMessage?.trim() ||
          t('recordDetails.cloneStructureCompletedCount', 'Created {count} record(s).', {
            count: result.created,
          })
        if (action.cloneRelated?.refreshRecordAfterRun !== false) {
          await options.onRefresh?.()
        }
      } else {
        await triggerFlowAction(
          action,
          collection.value,
          recordId.value,
          options.record(),
        )
        actionMessage.value =
          action.flow?.successMessage?.trim() ||
          t('recordDetails.actionCompleted', 'Action completed.')
        if (action.flow?.refreshRecordAfterRun !== false) {
          await options.onRefresh?.()
        }
      }
    } catch (err) {
      actionError.value =
        err instanceof Error
          ? err.message
          : t('recordDetails.actionFailed', 'Action failed.')
    } finally {
      actionRunning.value = { ...actionRunning.value, [action.id]: false }
    }
  }

  return {
    actionRunning,
    actionMessage,
    actionError,
    templatePickerVisible,
    templatePickerLoading,
    publishedTemplates,
    docValueListVisible,
    docValueListLoading,
    docValueListItems,
    fillDialogVisible,
    fillTemplateId,
    fillDocValueId,
    fillExportMode,
    fillAttachFile,
    runEntityAction,
    onExistingDocumentSelected,
    onNewDocumentFromList,
    onRuntimeTemplateSelected,
  }
}

export type EntityRecordActionsApi = ReturnType<typeof useEntityRecordActions>
