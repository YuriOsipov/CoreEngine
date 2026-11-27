import {
  flowResponseWasSync,
  parseFlowResponseContract,
} from '@/core/flowResponseContract'
import { t as translate } from '@/core/translation'

type FlowToast = {
  add: (message: {
    severity: 'success' | 'error'
    summary: string
    detail: string
    life: number
  }) => void
}

type Translate = typeof translate

export function externalFlowFallbackMessage(
  successMessage: string | undefined,
  translatedDefault: string,
): string {
  const raw = successMessage?.trim() ?? ''
  if (!raw || raw === 'Action completed.') return translatedDefault
  return raw
}

/**
 * A sync call toasts the response Message only. Showing the file is silent.
 * Other calls toast the action Success message.
 */
export async function presentExternalFlowResponse(input: {
  body: unknown
  /** Action property. Used only when the flow is not a sync request. */
  successMessage: string
  refreshAfterRun: boolean
  refresh?: () => void | Promise<void>
  toast: FlowToast
  t: Translate
  /** Open the preview dialog. The dialog saves only when attachFile is also set. */
  previewFile?: boolean
  attachFile?: boolean
  openFile?: (file: File) => void
  /** Save immediately when preview is off and attach is on. */
  saveFile?: (file: File) => Promise<void | boolean>
}): Promise<'success' | 'error'> {
  if (!flowResponseWasSync(input.body)) {
    input.toast.add({
      severity: 'success',
      summary: input.t('common.success', 'Success'),
      detail: input.successMessage,
      life: 4000,
    })
    if (input.refreshAfterRun) await input.refresh?.()
    return 'success'
  }

  const contract = parseFlowResponseContract(input.body)
  if (!contract) {
    if (input.refreshAfterRun) await input.refresh?.()
    return 'success'
  }

  if (!contract.success) {
    input.toast.add({
      severity: 'error',
      summary: input.t('common.error', 'Error'),
      detail:
        contract.message
        || input.t('recordDetails.actionFailed', 'Action failed.'),
      life: 5000,
    })
    return 'error'
  }

  const showingFile = Boolean(contract.file && input.previewFile)
  if (contract.message && !showingFile) {
    input.toast.add({
      severity: 'success',
      summary: input.t('common.success', 'Success'),
      detail: contract.message,
      life: 4000,
    })
  }
  if (showingFile && contract.file) {
    input.openFile?.(contract.file)
  } else if (contract.file && input.attachFile) {
    await input.saveFile?.(contract.file)
  }
  if (input.refreshAfterRun) await input.refresh?.()
  return 'success'
}
