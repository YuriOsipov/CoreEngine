import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/n8n')

interface WorkflowNode {
  name: string
  type: string
  parameters?: { path?: string }
}

interface WorkflowFile {
  name: string
  nodes: WorkflowNode[]
  connections: Record<string, { main?: Array<Array<{ node: string }>> }>
}

function loadWorkflows(): Array<{ file: string; workflow: WorkflowFile }> {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.workflow.json'))
    .sort()
    .map((file) => ({
      file,
      workflow: JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as WorkflowFile,
    }))
}

describe('n8n workflow templates', () => {
  const workflows = loadWorkflows()

  it('ships the common-flow set', () => {
    expect(workflows.map((entry) => entry.file)).toEqual([
      'crm-bff-flow.workflow.json',
      'dispatch-outbound-message.workflow.json',
      'failed-execution-alert.workflow.json',
      'generate-opportunity-document.workflow.json',
      'record-rest-patch.workflow.json',
      'send-appointment-reminder.workflow.json',
      'send-quote-pdf.workflow.json',
      'upsert-by-external-id.workflow.json',
    ])
  })

  it('pack write-back templates use ce-{key} webhook paths', () => {
    const byFile = Object.fromEntries(
      workflows.map((entry) => [entry.file, entry.workflow]),
    )
    const webhookPath = (file: string) =>
      byFile[file]?.nodes.find((n) => n.type === 'n8n-nodes-base.webhook')?.parameters
        ?.path
    expect(webhookPath('dispatch-outbound-message.workflow.json')).toBe(
      'ce-dispatch_outbound_message',
    )
    expect(webhookPath('send-quote-pdf.workflow.json')).toBe('ce-send_quote_pdf')
    expect(webhookPath('send-appointment-reminder.workflow.json')).toBe(
      'ce-send_appointment_reminder',
    )
    expect(webhookPath('generate-opportunity-document.workflow.json')).toBe(
      'ce-send_opportunity_document',
    )
  })

  it.each(workflows.map((entry) => [entry.file, entry.workflow] as const))(
    '%s connects only to nodes that exist',
    (_file, workflow) => {
      const names = new Set(workflow.nodes.map((node) => node.name))
      expect(workflow.name.trim().length).toBeGreaterThan(0)
      expect(names.size).toBe(workflow.nodes.length)
      for (const [source, outputs] of Object.entries(workflow.connections)) {
        expect(names.has(source)).toBe(true)
        for (const lane of outputs.main ?? []) {
          for (const link of lane) {
            expect(names.has(link.node)).toBe(true)
          }
        }
      }
    },
  )

  it('alert template starts from the n8n error trigger', () => {
    const alert = workflows.find((entry) => entry.file === 'failed-execution-alert.workflow.json')
    expect(alert?.workflow.nodes.some((node) => node.type === 'n8n-nodes-base.errorTrigger')).toBe(
      true,
    )
  })
})
