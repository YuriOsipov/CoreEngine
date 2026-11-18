import { afterEach, describe, expect, it } from 'vitest'
import {
  isN8nDestination,
  n8nBaseUrl,
  n8nWebhookPathForKey,
  resolveN8nFlowUrl,
} from './flowAuth.js'

const ORIGINAL = {
  N8N_BASE_URL: process.env.N8N_BASE_URL,
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
}

afterEach(() => {
  if (ORIGINAL.N8N_BASE_URL === undefined) delete process.env.N8N_BASE_URL
  else process.env.N8N_BASE_URL = ORIGINAL.N8N_BASE_URL
  if (ORIGINAL.N8N_WEBHOOK_URL === undefined) delete process.env.N8N_WEBHOOK_URL
  else process.env.N8N_WEBHOOK_URL = ORIGINAL.N8N_WEBHOOK_URL
})

describe('n8n flow URL helpers', () => {
  it('builds stable ce-{key} paths', () => {
    expect(n8nWebhookPathForKey('send_quote_pdf')).toBe('ce-send_quote_pdf')
    expect(n8nWebhookPathForKey('Send Appointment Reminder!')).toBe(
      'ce-send_appointment_reminder',
    )
  })

  it('resolves from N8N_BASE_URL', () => {
    process.env.N8N_BASE_URL = 'http://n8n:5678/'
    delete process.env.N8N_WEBHOOK_URL
    expect(n8nBaseUrl()).toBe('http://n8n:5678')
    expect(resolveN8nFlowUrl('send_quote_pdf')).toBe(
      'http://n8n:5678/webhook/ce-send_quote_pdf',
    )
  })

  it('falls back to N8N_WEBHOOK_URL origin', () => {
    delete process.env.N8N_BASE_URL
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example/webhook/crm-flow'
    expect(n8nBaseUrl()).toBe('https://n8n.example')
    expect(resolveN8nFlowUrl('n8n-webhook')).toBe(
      'https://n8n.example/webhook/ce-n8n-webhook',
    )
  })

  it('detects n8n destinations for secret injection', () => {
    process.env.N8N_BASE_URL = 'http://n8n:5678'
    expect(isN8nDestination(new URL('http://n8n:5678/webhook/ce-x'))).toBe(true)
    expect(isN8nDestination(new URL('https://evil.example/webhook'))).toBe(false)
  })
})
