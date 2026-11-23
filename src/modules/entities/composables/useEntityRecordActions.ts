import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConfirm } from 'openvue/useconfirm'
import { useToast } from 'openvue/usetoast'
import type { EntityAction } from '@/interfaces'
import { triggerFlowAction } from '@/modules/entities/services/recordDetails'
import { applyCloneRelatedAction } from '@/modules/entities/services/cloneRelatedFromSource'
import { applyBulkUpdateRelatedAction } from '@/modules/entities/services/bulkUpdateRelatedAction'
import {
  loadDocTemplateByIdForCurrentUser,
  loadPublishedDocTemplateOptions,
} from '@/modules/documents/services/docTemplateService'
import { loadDocValueListItems } from '@/modules/documents/services/docValueService'
import type { DocEngineExportMode, DocTemplateOption, DocValueListItem } from '@/interfaces'
import { useTranslation } from '@/core/translation'
import {
  buildCreateRecordInitialValues,
  canShowCreateRecordAction,
} from '@/core/createRecordAction'
import { canCreateEntity } from '@/core/entityPermissions'
import { canWriteOwnedRecord } from '@/core/ownerRowWriteAccess'
import { currentUserId, peekCachedCurrentUserId } from '@/core/currentUser'
import { resolveMessageComposeFromEmail } from '@/core/messageCreateDefaults'
import { extractRelationFieldId } from '@/modules/entities/utils/recordDisplay'

export function useEntityRecordActions(options: {
  collection: () => string
  recordId: () => string
  record: () => Record<string, unknown>
  onRefresh?: () => void | Promise<void>
  /** When false, source row is treated as not writable (owner RLS). Default: derive from record. */
  sourceWritable?: () => boolean
}) {
  const confirm = useConfirm()
  const toast = useToast()
  const router = useRouter()
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

  const viewDialogVisible = ref(false)
  const viewTemplateId = ref('')
  const viewDocValueId = ref<string | null>(null)
  const viewMode = ref<DocEngineExportMode>('html')
  const viewAutoSave = ref(false)
  const viewAttachFile = ref(false)

  const numberPromptVisible = ref(false)
  const numberPromptLabel = ref('')
  const numberPromptHeader = ref('')
  const pendingBulkAction = ref<EntityAction | null>(null)

  const createDialogVisible = ref(false)
  const createTargetCollection = ref('')
  const createInitialValues = ref<Record<string, unknown>>({})
  const createOpenAfterCreate = ref(true)

  const collection = computed(() => options.collection())
  const recordId = computed(() => options.recordId())

  function isSourceWritable(): boolean {
    if (options.sourceWritable) return options.sourceWritable()
    const me = peekCachedCurrentUserId()
    return canWriteOwnedRecord(options.record(), me)
  }

  function confirmBeforeRunForAction(action: EntityAction): boolean {
    if (action.behavior === 'cloneRelated') {
      return action.cloneRelated?.confirmBeforeRun !== false
    }
    if (action.behavior === 'bulkUpdateRelated') {
      return action.bulkUpdateRelated?.confirmBeforeRun !== false
    }
    if (action.behavior === 'createRecord') return false
    return action.flow?.confirmBeforeRun !== false
  }

  async function openCreateRecordAction(action: EntityAction): Promise<void> {
    const settings = action.createRecord
    const target = String(settings?.targetCollection ?? '').trim()
    if (!target) {
      toast.add({
        severity: 'warn',
        summary: t('common.warning', 'Warning'),
        detail: t('formBuilder.createRecordMissingTarget', 'Select a target object for this action.'),
        life: 4000,
      })
      return
    }
    if (
      !canShowCreateRecordAction({
        settings,
        canCreateTarget: canCreateEntity(target),
        sourceWritable: isSourceWritable(),
      })
    ) {
      toast.add({
        severity: 'warn',
        summary: t('common.warning', 'Warning'),
        detail: t(
          'formBuilder.createRecordRequiresCreate',
          'You do not have permission to create that object.',
        ),
        life: 4000,
      })
      return
    }
    const fromUserId = peekCachedCurrentUserId() ?? (await currentUserId())
    const fromEmail = await resolveMessageComposeFromEmail(fromUserId)
    createTargetCollection.value = target
    createOpenAfterCreate.value = settings?.openAfterCreate !== false
    createInitialValues.value = buildCreateRecordInitialValues(settings, options.record(), {
      userId: fromUserId,
      email: fromEmail,
    })
    createDialogVisible.value = true
  }

  function onCreateRecordCreated(record: Record<string, unknown>): void {
    createDialogVisible.value = false
    if (!createOpenAfterCreate.value) {
      void options.onRefresh?.()
      return
    }
    const id =
      extractRelationFieldId(record.id) ??
      (record.id != null && record.id !== '' ? String(record.id) : null)
    if (!id || !createTargetCollection.value) return
    void router.push(
      `/object/${encodeURIComponent(createTargetCollection.value)}/${encodeURIComponent(id)}`,
    )
  }

  function openBulkUpdatePrompt(action: EntityAction): void {
    pendingBulkAction.value = action
    numberPromptHeader.value = action.label
    numberPromptLabel.value =
      action.bulkUpdateRelated?.promptLabel?.trim()
      || t('recordDetails.actionPromptMultiplier', 'Multiplier')
    numberPromptVisible.value = true
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

  function runEntityAction(action: EntityAction): void {
    if (actionRunning.value[action.id]) return
    if (!collection.value || !recordId.value) return

    if (action.behavior === 'openDocument' || action.displayType === 'document') {
      void openDocumentAction(action)
      return
    }

    if (action.behavior === 'createRecord') {
      void openCreateRecordAction(action)
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

  function onNumberPromptConfirm(multiplier: number): void {
    const action = pendingBulkAction.value
    pendingBulkAction.value = null
    if (!action) return
    confirmOrRunBulkUpdate(action, multiplier)
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
        const result = await applyCloneRelatedAction(action, collection.value, options.record())
        actionMessage.value =
          action.cloneRelated?.successMessage?.trim() ||
          t('recordDetails.cloneStructureCompletedCount', 'Created {count} record(s).', {
            count: result.created,
          })
        if (action.cloneRelated?.refreshRecordAfterRun !== false) {
          await options.onRefresh?.()
        }
      } else if (action.behavior === 'bulkUpdateRelated') {
        if (multiplier == null || !Number.isFinite(multiplier)) {
          throw new Error(
            t('recordDetails.actionPromptRequired', 'Enter a numeric value to continue.'),
          )
        }
        const result = await applyBulkUpdateRelatedAction(
          action,
          collection.value,
          recordId.value,
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
      const message =
        err instanceof Error
          ? err.message
          : t('recordDetails.actionFailed', 'Action failed.')
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
    viewDialogVisible,
    viewTemplateId,
    viewDocValueId,
    viewMode,
    viewAutoSave,
    viewAttachFile,
    numberPromptVisible,
    numberPromptLabel,
    numberPromptHeader,
    createDialogVisible,
    createTargetCollection,
    createInitialValues,
    runEntityAction,
    onNumberPromptConfirm,
    onCreateRecordCreated,
    onExistingDocumentSelected,
    onNewDocumentFromList,
    onRuntimeTemplateSelected,
  }
}

export type EntityRecordActionsApi = ReturnType<typeof useEntityRecordActions>
