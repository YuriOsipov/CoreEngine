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
      'ingest-inbound-email.workflow.json',
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

  it('BFF-triggered templates gate on X-CRM-Flow-Secret / N8N_WEBHOOK_SECRET', () => {
    const gated = workflows.filter((entry) =>
      [
        'crm-bff-flow.workflow.json',
        'dispatch-outbound-message.workflow.json',
        'generate-opportunity-document.workflow.json',
        'record-rest-patch.workflow.json',
        'send-appointment-reminder.workflow.json',
        'send-quote-pdf.workflow.json',
      ].includes(entry.file),
    )
    expect(gated.length).toBe(6)
    for (const { file, workflow } of gated) {
      const raw = JSON.stringify(workflow)
      expect(raw, file).toMatch(/N8N_WEBHOOK_SECRET/)
      expect(raw, file).toMatch(/X-CRM-Flow-Secret|x-crm-flow-secret/i)
    }
  })

  it('outbox SMTP failure path marks message failed then rethrows', () => {
    const outbox = workflows.find((entry) => entry.file === 'dispatch-outbound-message.workflow.json')
    expect(outbox).toBeTruthy()
    const workflow = outbox!.workflow as WorkflowFile & {
      connections: Record<string, { main?: Array<Array<{ node: string }>> }>
      nodes: Array<
        WorkflowNode & {
          onError?: string
          parameters?: {
            responseMode?: string
            subject?: string
            jsCode?: string
            url?: string
          }
        }
      >
    }
    const webhook = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.webhook')
    expect(webhook?.parameters?.responseMode).toBe('lastNode')
    for (const name of ['Send email', 'Send email (with files)']) {
      const node = workflow.nodes.find((n) => n.name === name)
      expect(node?.onError, name).toBe('continueErrorOutput')
      expect(node?.parameters?.subject, name).toBe('={{$json.subject}}')
      expect(workflow.connections[name]?.main?.[1]?.some((l) => l.node === 'Mark failed')).toBe(true)
    }
    expect(workflow.connections['Mark failed']?.main?.[0]?.some((l) => l.node === 'Rethrow after failed')).toBe(
      true,
    )
    expect(workflow.nodes.some((n) => n.name === 'Load message')).toBe(true)
    expect(workflow.nodes.some((n) => n.name === 'Merge message record')).toBe(true)
    const route = workflow.nodes.find((n) => n.name === 'Route payload')
    expect(route?.parameters?.jsCode).toMatch(/record\.subject/)
    expect(route?.parameters?.jsCode).toMatch(/rawType === 'email'|channel === 'email'/)
    expect(route?.parameters?.jsCode).not.toMatch(/type === 1\b/)
  })

  it('inbound IMAP template upserts incoming_message by external_message_id', () => {
    const inbound = workflows.find((entry) => entry.file === 'ingest-inbound-email.workflow.json')
    expect(inbound).toBeTruthy()
    const workflow = inbound!.workflow as WorkflowFile & {
      nodes: Array<
        WorkflowNode & {
          parameters?: { jsCode?: string; url?: string; mailbox?: string }
        }
      >
    }
    expect(
      workflow.nodes.some((n) => n.type === 'n8n-nodes-base.emailReadImap'),
    ).toBe(true)
    expect(workflow.nodes.some((n) => n.type === 'n8n-nodes-base.webhook')).toBe(false)
    const resolve = workflow.nodes.find((n) => n.name === 'Resolve owner')
    expect(resolve?.parameters?.jsCode).toMatch(/CRM_INBOUND_FALLBACK_OWNER_ID/)
    expect(resolve?.parameters?.jsCode).toMatch(/CRM_INBOUND_ROUTE_MAP/)
    expect(resolve?.parameters?.jsCode).toMatch(/\/api\/v1\/users\/email:/)
    const upsert = workflow.nodes.find((n) => n.name === 'Upsert incoming message')
    expect(upsert?.parameters?.url).toMatch(
      /incoming_message\?upsert=true&by=external_message_id/,
    )
  })
})
