export const AUTOMATION_TOASTS_KEY = '__automationToasts'

export type AutomationToastSeverity = 'info' | 'warn'

export interface AutomationToastMessage {
  severity: AutomationToastSeverity
  message: string
}

type AutomationToastListener = (toasts: AutomationToastMessage[]) => void

const listeners = new Set<AutomationToastListener>()

export function subscribeAutomationToasts(
  listener: AutomationToastListener,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishAutomationToasts(
  toasts: AutomationToastMessage[],
): void {
  if (!toasts.length) return
  for (const listener of listeners) {
    listener(toasts)
  }
}

function normalizeToast(raw: unknown): AutomationToastMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const message = String(row.message ?? '').trim()
  if (!message) return null
  const severityRaw = String(row.severity ?? 'info')
    .trim()
    .toLowerCase()
  const severity: AutomationToastSeverity =
    severityRaw === 'warn' ||
    severityRaw === 'warning' ||
    severityRaw === 'alarm'
      ? 'warn'
      : 'info'
  return { severity, message }
}

/** Strip reserved automation toast payload from a mutation record and publish it. */
export function consumeAutomationToastsFromRecord(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!record || typeof record !== 'object') return {}
  const next = { ...record }
  const raw = next[AUTOMATION_TOASTS_KEY]
  delete next[AUTOMATION_TOASTS_KEY]
  if (Array.isArray(raw)) {
    const toasts = raw
      .map((entry) => normalizeToast(entry))
      .filter((entry): entry is AutomationToastMessage => Boolean(entry))
    publishAutomationToasts(toasts)
  }
  return next
}
