import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { buildTemplateExport } from '@docengine/editor'
import type DocEditorHost from '@/core/ui-kit/DocEditorHost.vue'
import { currentUserRole } from '@/core/currentUser'
import { useTranslation } from '@/core/translation'
import {
  DOC_DOCUMENT_STATUS_COMPLETED,
  DOC_DOCUMENT_STATUS_DRAFT,
  normalizeDocDocumentStatus,
  type DocDocumentStatus,
  type DocEngineExportMode,
} from '@/interfaces/documents'
import { applyDocFieldMapping, fetchDocMappingPayload } from '../services/docFieldMapping'
import { uploadDocumentExportArtifact } from '../services/docExportArtifact'
import { buildRenderableDocument, type RenderableDocPreview } from '../services/docPopulation'
import { loadDocTemplateById } from '../services/docTemplateService'
import { canAccessDocTemplate } from '../services/docTemplateRole'
import {
  loadDocTemplateSnapshotById,
  resolveDocTemplateSnapshotId,
  resolveSnapshotIdForPin,
} from '../services/docTemplateSnapshotService'
import {
  loadDocValueById,
  resolveDocValueTemplateId,
  saveDocValue,
} from '../services/docValueService'

type EditorHost = InstanceType<typeof DocEditorHost>

export function useDocFillSession(options: {
  collection: Ref<string>
  recordId: Ref<string>
  templateId: Ref<string>
  docValueId: Ref<string | null>
  exportMode: Ref<DocEngineExportMode>
  /** When false, finish skips uploading an export attachment. Default true. */
  attachFile?: Ref<boolean>
  active: Ref<boolean>
}) {
  const { t } = useTranslation()

  const editorRef = ref<EditorHost | null>(null)
  const documentName = ref('')
  const currentDocValueId = ref<string | null>(null)
  const documentStatus = ref<DocDocumentStatus>(DOC_DOCUMENT_STATUS_DRAFT)
  const editorNeeded = ref(false)
  const previewDocument = ref<RenderableDocPreview | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const dirty = ref(false)
  /** Set when Finish saved the doc but export attach failed. */
  const attachWarning = ref<string | null>(null)

  const readOnly = computed(
    () => documentStatus.value === DOC_DOCUMENT_STATUS_COMPLETED,
  )
  const canSaveDraft = computed(() => !readOnly.value)

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

  async function loadEditorState(): Promise<void> {
    if (
      !options.active.value ||
      !options.collection.value ||
      !options.recordId.value ||
      !options.templateId.value
    ) {
      return
    }

    loading.value = true
    error.value = null
    dirty.value = false
    editorNeeded.value = false
    previewDocument.value = null
    currentDocValueId.value = options.docValueId.value
    documentStatus.value = DOC_DOCUMENT_STATUS_DRAFT

    try {
      const templateRecord = await loadDocTemplateById(options.templateId.value)
      if (!templateRecord) {
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

      if (!templateRecord.body) {
        throw new Error(t('documents.templateNotFound', 'Document template not found.'))
      }

      documentName.value = templateRecord.name

      let savedValues: Record<string, unknown> | null = null
      let reopenMode: 'full' | 'new' = 'new'
      let structureBody: Record<string, unknown> = templateRecord.body

      if (options.docValueId.value) {
        const docValueRecord = await loadDocValueById(options.docValueId.value)
        if (!docValueRecord) {
          throw new Error(t('documents.documentNotFound', 'Document not found.'))
        }
        documentName.value =
          docValueRecord.template &&
          typeof docValueRecord.template === 'object' &&
          docValueRecord.template.name
            ? docValueRecord.template.name
            : documentName.value

        documentStatus.value = normalizeDocDocumentStatus(docValueRecord.document_status)
        savedValues = docValueRecord.values ?? null
        const recordTemplateId = resolveDocValueTemplateId(docValueRecord.template)
        if (recordTemplateId && recordTemplateId !== options.templateId.value) {
          throw new Error(
            t('documents.documentTemplateMismatch', 'Document template mismatch.'),
          )
        }

        if (documentStatus.value === DOC_DOCUMENT_STATUS_COMPLETED) {
          const snapshotId = resolveDocTemplateSnapshotId(docValueRecord.template_snapshot)
          if (snapshotId) {
            const snapshot = await loadDocTemplateSnapshotById(snapshotId)
            if (snapshot?.body) {
              structureBody = snapshot.body
            }
          }
          previewDocument.value = buildRenderableDocument(structureBody, savedValues)
          return
        }

        if (savedValues) {
          reopenMode = 'full'
        }
      }

      editorNeeded.value = true
      await nextTick()
      await waitForEditor()

      if (reopenMode === 'full' && savedValues) {
        await editorRef.value!.load(savedValues)
      } else {
        await editorRef.value!.load(structureBody)
        const mapping = templateRecord.field_mapping
        if (mapping && typeof mapping === 'object' && Object.keys(mapping).length > 0) {
          const record = await fetchDocMappingPayload(
            options.collection.value,
            options.recordId.value,
            mapping as Record<string, unknown>,
          )
          const mappingTemplate =
            structureBody?.kind === 'document'
              ? buildTemplateExport(structureBody as never)
              : structureBody
          const mapped = await applyDocFieldMapping(
            options.collection.value,
            mapping as Record<string, unknown>,
            record,
            mappingTemplate as never,
          )
          if (mapped?.fieldsExport) {
            await editorRef.value!.load(
              mapped.fieldsExport as unknown as Record<string, unknown>,
            )
          }
        }
      }

      dirty.value = false
    } catch (err) {
      error.value =
        err instanceof Error
          ? err.message
          : t('documents.loadFillError', 'Failed to load document editor.')
      throw err
    } finally {
      loading.value = false
    }
  }

  async function saveDraft(): Promise<string> {
    saving.value = true
    error.value = null
    try {
      if (!canSaveDraft.value) {
        throw new Error(
          t('documents.cannotDraftCompleted', 'Completed documents cannot be saved as draft.'),
        )
      }
      await waitForEditor()
      const fullDoc = await editorRef.value?.exportDoc()
      if (!fullDoc) {
        throw new Error(t('documents.exportValuesError', 'Failed to export document values.'))
      }

      const saved = await saveDocValue(
        {
          templateId: options.templateId.value,
          parentCollection: options.collection.value,
          parentId: options.recordId.value,
          values: fullDoc,
          documentStatus: DOC_DOCUMENT_STATUS_DRAFT,
        },
        currentDocValueId.value,
      )
      currentDocValueId.value = String(saved.id)
      documentStatus.value = DOC_DOCUMENT_STATUS_DRAFT
      dirty.value = false
      return String(saved.id)
    } catch (err) {
      error.value =
        err instanceof Error
          ? err.message
          : t('documents.saveDocumentError', 'Failed to save document.')
      throw err
    } finally {
      saving.value = false
    }
  }

  async function finish(): Promise<string> {
    saving.value = true
    error.value = null
    attachWarning.value = null
    try {
      if (readOnly.value) {
        throw new Error(
          t('documents.cannotEditCompleted', 'Completed documents cannot be edited.'),
        )
      }
      await waitForEditor()
      const validation = await editorRef.value?.validate()
      if (validation && !validation.valid) {
        const missing = validation.missing.map((item) => item.label).join(', ')
        throw new Error(
          t('documents.missingRequiredFields', 'Required fields are missing: {fields}', {
            fields: missing,
          }),
        )
      }

      // Values only (FieldsExport). Structure comes from the pinned template snapshot.
      // `exportFields` collapses materialized `_source` section clones back to
      // `sections.Name: [{…}, {…}]` so completed view can re-expand them.
      const values = await editorRef.value?.exportFields()
      if (!values) {
        throw new Error(t('documents.exportValuesError', 'Failed to export document values.'))
      }

      const fullDoc = await editorRef.value?.exportDoc()
      if (!fullDoc) {
        throw new Error(t('documents.exportValuesError', 'Failed to export document values.'))
      }

      const snapshotId = await resolveSnapshotIdForPin(options.templateId.value)
      const saved = await saveDocValue(
        {
          templateId: options.templateId.value,
          parentCollection: options.collection.value,
          parentId: options.recordId.value,
          values,
          documentStatus: DOC_DOCUMENT_STATUS_COMPLETED,
          templateSnapshotId: snapshotId,
          completedDate: new Date().toISOString(),
        },
        currentDocValueId.value,
      )
      currentDocValueId.value = String(saved.id)

      const shouldAttach = options.attachFile?.value !== false
      if (shouldAttach) {
        try {
          const fileId = await uploadDocumentExportArtifact({
            doc: fullDoc,
            mode: options.exportMode.value,
            title: documentName.value || 'document',
            parentCollection: options.collection.value,
            parentId: options.recordId.value,
          })

          await saveDocValue(
            {
              templateId: options.templateId.value,
              parentCollection: options.collection.value,
              parentId: options.recordId.value,
              values,
              documentStatus: DOC_DOCUMENT_STATUS_COMPLETED,
              templateSnapshotId: snapshotId,
              completedDate: new Date().toISOString(),
              outputFileId: fileId,
            },
            currentDocValueId.value,
          )
        } catch (attachErr) {
          // Document is already completed — keep Finish successful and warn about attach.
          attachWarning.value =
            attachErr instanceof Error
              ? attachErr.message
              : t(
                  'documents.attachExportError',
                  'Document saved, but export file could not be attached.',
                )
        }
      }

      documentStatus.value = DOC_DOCUMENT_STATUS_COMPLETED
      dirty.value = false
      return String(currentDocValueId.value)
    } catch (err) {
      error.value =
        err instanceof Error
          ? err.message
          : t('documents.saveDocumentError', 'Failed to save document.')
      throw err
    } finally {
      saving.value = false
    }
  }

  async function preview(): Promise<void> {
    await waitForEditor()
    await editorRef.value?.preview()
  }

  function markDirty(): void {
    dirty.value = true
  }

  /** Field answers for a standard scenario. Mapped CRM fields stay on the record. */
  async function exportScenarioValues(): Promise<Record<string, unknown>> {
    if (readOnly.value) {
      throw new Error(
        t('documents.cannotEditCompleted', 'Completed documents cannot be edited.'),
      )
    }
    await waitForEditor()
    const values = await editorRef.value?.exportFields({ omitMappedFields: true })
    if (!values || values.kind !== 'field') {
      throw new Error(t('documents.exportValuesError', 'Failed to export document values.'))
    }
    return values
  }

  async function applyScenario(values: Record<string, unknown>): Promise<void> {
    if (readOnly.value) {
      throw new Error(
        t('documents.cannotEditCompleted', 'Completed documents cannot be edited.'),
      )
    }
    if (!values || values.kind !== 'field') {
      throw new Error(t('documents.applyScenarioError', 'Failed to apply scenario.'))
    }
    await waitForEditor()
    await editorRef.value!.load(values)
    dirty.value = true
  }

  watch(
    [
      () => options.active.value,
      () => options.collection.value,
      () => options.recordId.value,
      () => options.templateId.value,
      () => options.docValueId.value,
    ],
    () => {
      if (!options.active.value) return
      void loadEditorState().catch(() => {
        /* error already set */
      })
    },
    { immediate: true },
  )

  return {
    editorRef,
    documentName,
    currentDocValueId,
    documentStatus,
    editorNeeded,
    previewDocument,
    readOnly,
    loading,
    saving,
    error,
    dirty,
    attachWarning,
    canSaveDraft,
    loadEditorState,
    saveDraft,
    finish,
    preview,
    markDirty,
    exportScenarioValues,
    applyScenario,
  }
}
