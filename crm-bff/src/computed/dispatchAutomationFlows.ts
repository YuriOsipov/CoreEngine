/**
 * Fire-and-forget local flows collected from record automation trigger_flow actions.
 * Never throws to the caller — write path must stay successful.
 */
import { runLocalFlow } from '../flows/localFlows.js'
import type { RecordAutomationTrigger } from '../schema/recordAutomations.js'
import type { AutomationFlowTrigger } from './applyRecordAutomations.js'

export async function dispatchAutomationFlows(input: {
  entityApiName: string
  recordId: string
  record: Record<string, unknown>
  before: Record<string, unknown> | null
  trigger: RecordAutomationTrigger
  flowTriggers: AutomationFlowTrigger[]
}): Promise<void> {
  if (!input.flowTriggers.length) return

  const seen = new Set<string>()
  for (const entry of input.flowTriggers) {
    const flowKey = entry.flowKey.trim()
    if (!flowKey || seen.has(flowKey)) continue
    seen.add(flowKey)

    const payload: Record<string, unknown> = {
      source: 'record_automation',
      trigger: input.trigger,
      collection: input.entityApiName,
      recordId: input.recordId,
      record: input.record,
      before: input.before,
      automation: {
        id: entry.automationId,
        name: entry.automationName,
      },
    }

    try {
      await runLocalFlow(flowKey, payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[dispatchAutomationFlows] ${input.entityApiName} ${input.trigger} ` +
          `flow="${flowKey}" automation="${entry.automationId}": ${message}`,
      )
    }
  }
}

/** Schedule flows without blocking the GraphQL write response. */
export function scheduleAutomationFlows(
  input: Parameters<typeof dispatchAutomationFlows>[0],
): void {
  if (!input.flowTriggers.length) return
  void dispatchAutomationFlows(input)
}
