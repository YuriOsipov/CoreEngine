import { ref } from 'vue'
import { useToast } from 'openvue/usetoast'
import { useTranslation } from '@/core/translation'
import { attachFlowResponseFile } from '@/modules/entities/services/attachFlowResponseFile'

export function useExternalFlowFileDialog(options?: {
  onSaved?: () => void | Promise<void>
}) {
  const toast = useToast()
  const { t } = useTranslation()
  const flowFileVisible = ref(false)
  const flowFile = ref<File | null>(null)
  const flowFileAllowSave = ref(false)
  const flowFileSaving = ref(false)
  const parentCollection = ref('')
  const parentRecordId = ref('')

  function openFlowFile(
    file: File,
    collection: string,
    recordId: string,
    allowSave = false,
  ): void {
    flowFile.value = file
    flowFileAllowSave.value = allowSave
    parentCollection.value = collection
    parentRecordId.value = recordId
    flowFileVisible.value = true
  }

  async function persistFlowFile(
    file: File,
    collection: string,
    recordId: string,
  ): Promise<boolean> {
    try {
      await attachFlowResponseFile(file, collection, recordId)
      toast.add({
        severity: 'success',
        summary: t('common.success', 'Success'),
        detail: t('recordDetails.flowFileSaved', 'File saved to attachments.'),
        life: 4000,
      })
      await options?.onSaved?.()
      return true
    } catch (err) {
      const detail =
        err instanceof Error && err.message
          ? err.message
          : t(
              'recordDetails.flowFileSaveError',
              'Failed to save the file to attachments.',
            )
      toast.add({
        severity: 'error',
        summary: t('common.error', 'Error'),
        detail,
        life: 5000,
      })
      return false
    }
  }

  async function saveFlowFile(): Promise<void> {
    const file = flowFile.value
    if (!file || flowFileSaving.value || !flowFileAllowSave.value) return
    flowFileSaving.value = true
    try {
      const saved = await persistFlowFile(
        file,
        parentCollection.value,
        parentRecordId.value,
      )
      if (saved) flowFileVisible.value = false
    } finally {
      flowFileSaving.value = false
    }
  }

  function saveFlowFileNow(file: File, collection: string, recordId: string): Promise<boolean> {
    return persistFlowFile(file, collection, recordId)
  }

  return {
    flowFileVisible,
    flowFile,
    flowFileAllowSave,
    flowFileSaving,
    openFlowFile,
    saveFlowFile,
    saveFlowFileNow,
  }
}
