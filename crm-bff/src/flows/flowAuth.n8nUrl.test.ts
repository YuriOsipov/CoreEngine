import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendSyncPath,
  assertProductionFlowAuthConfig,
  isActivepiecesDestination,
  isN8nDestination,
  n8nBaseUrl,
  n8nWebhookPathForKey,
  resolveActivepiecesFlowUrl,
  resolveCustomFlowUrl,
  resolveN8nFlowUrl,
  sanitizeActivepiecesFlowId,
  warnIfActivepiecesWebhookSecretMissing,
  warnIfN8nWebhookSecretMissing,
} from './flowAuth.js'

const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  N8N_BASE_URL: process.env.N8N_BASE_URL,
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL,
  N8N_WEBHOOK_SECRET: process.env.N8N_WEBHOOK_SECRET,
  ACTIVEPIECES_BASE_URL: process.env.ACTIVEPIECES_BASE_URL,
  ACTIVEPIECES_WEBHOOK_SECRET: process.env.ACTIVEPIECES_WEBHOOK_SECRET,
  FLOWS_TRIGGER_REQUIRE_AUTH: process.env.FLOWS_TRIGGER_REQUIRE_AUTH,
}

afterEach(() => {
  if (ORIGINAL.NODE_ENV === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = ORIGINAL.NODE_ENV
  if (ORIGINAL.N8N_BASE_URL === undefined) delete process.env.N8N_BASE_URL
  else process.env.N8N_BASE_URL = ORIGINAL.N8N_BASE_URL
  if (ORIGINAL.N8N_WEBHOOK_URL === undefined) delete process.env.N8N_WEBHOOK_URL
  else process.env.N8N_WEBHOOK_URL = ORIGINAL.N8N_WEBHOOK_URL
  if (ORIGINAL.N8N_WEBHOOK_SECRET === undefined) delete process.env.N8N_WEBHOOK_SECRET
  else process.env.N8N_WEBHOOK_SECRET = ORIGINAL.N8N_WEBHOOK_SECRET
  if (ORIGINAL.ACTIVEPIECES_BASE_URL === undefined) {
    delete process.env.ACTIVEPIECES_BASE_URL
  } else {
    process.env.ACTIVEPIECES_BASE_URL = ORIGINAL.ACTIVEPIECES_BASE_URL
  }
  if (ORIGINAL.ACTIVEPIECES_WEBHOOK_SECRET === undefined) {
    delete process.env.ACTIVEPIECES_WEBHOOK_SECRET
  } else {
    process.env.ACTIVEPIECES_WEBHOOK_SECRET = ORIGINAL.ACTIVEPIECES_WEBHOOK_SECRET
  }
  if (ORIGINAL.FLOWS_TRIGGER_REQUIRE_AUTH === undefined) {
    delete process.env.FLOWS_TRIGGER_REQUIRE_AUTH
  } else {
    process.env.FLOWS_TRIGGER_REQUIRE_AUTH = ORIGINAL.FLOWS_TRIGGER_REQUIRE_AUTH
  }
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
    expect(resolveN8nFlowUrl('send_quote_pdf', { sync: true })).toBe(
      'http://n8n:5678/webhook/ce-send_quote_pdf/sync',
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

  it('production refuses n8n without webhook secret', () => {
    process.env.NODE_ENV = 'production'
    process.env.FLOWS_TRIGGER_REQUIRE_AUTH = 'true'
    process.env.N8N_BASE_URL = 'http://n8n:5678'
    delete process.env.N8N_WEBHOOK_SECRET
    expect(() => assertProductionFlowAuthConfig()).toThrow(/N8N_WEBHOOK_SECRET/)
    process.env.N8N_WEBHOOK_SECRET = 'shared-secret'
    expect(() => assertProductionFlowAuthConfig()).not.toThrow()
  })

  it('warns in non-production when secret is missing', () => {
    process.env.NODE_ENV = 'development'
    process.env.N8N_BASE_URL = 'http://n8n:5678'
    delete process.env.N8N_WEBHOOK_SECRET
    const warn = vi.fn()
    warnIfN8nWebhookSecretMissing({ warn })
    expect(warn).toHaveBeenCalledOnce()
    process.env.N8N_WEBHOOK_SECRET = 'x'
    warn.mockClear()
    warnIfN8nWebhookSecretMissing({ warn })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('custom flow URL /sync', () => {
  it('appends /sync before the query string and does not double it', () => {
    expect(appendSyncPath('https://integrations.example/api/hook?token=1')).toBe(
      'https://integrations.example/api/hook/sync?token=1',
    )
    expect(appendSyncPath('https://integrations.example/api/hook/sync')).toBe(
      'https://integrations.example/api/hook/sync',
    )
    expect(appendSyncPath('https://integrations.example/api/hook/')).toBe(
      'https://integrations.example/api/hook/sync',
    )
  })

  it('appends /sync only when Wait for response is on', () => {
    const url = 'https://integrations.example/api/hook'
    expect(resolveCustomFlowUrl(url, {})).toBe(url)
    expect(resolveCustomFlowUrl(url, { sync: 'true' })).toBe(`${url}/sync`)
    expect(resolveCustomFlowUrl('not a url', { sync: true })).toBe('not a url')
    const fileUrl =
      'https://fastly.picsum.photos/id/813/536/354.jpg?hmac=abc'
    expect(resolveCustomFlowUrl(fileUrl, { sync: true })).toBe(fileUrl)
  })
})

describe('Activepieces flow URL helpers', () => {
  it('sanitizes flow ids from Catch Webhook Live URL', () => {
    expect(sanitizeActivepiecesFlowId('abc123XYZ')).toBe('abc123XYZ')
    expect(sanitizeActivepiecesFlowId('/flow_id-1/')).toBe('flow_id-1')
    expect(() => sanitizeActivepiecesFlowId('')).toThrow(/flowId/)
    expect(() => sanitizeActivepiecesFlowId('bad/id')).toThrow(/alphanumeric/)
  })

  it('resolves from ACTIVEPIECES_BASE_URL + flowId', () => {
    process.env.ACTIVEPIECES_BASE_URL = 'http://activepieces:80/'
    expect(
      resolveActivepiecesFlowUrl({ flowId: 'QkLmNoPqRs' }),
    ).toBe('http://activepieces:80/api/v1/webhooks/QkLmNoPqRs')
    expect(
      resolveActivepiecesFlowUrl({ flowId: 'QkLmNoPqRs', sync: true }),
    ).toBe('http://activepieces:80/api/v1/webhooks/QkLmNoPqRs/sync')
  })

  it('detects Activepieces destinations for secret injection', () => {
    process.env.ACTIVEPIECES_BASE_URL = 'http://activepieces:80'
    expect(
      isActivepiecesDestination(
        new URL('http://activepieces:80/api/v1/webhooks/x'),
      ),
    ).toBe(true)
    expect(
      isActivepiecesDestination(new URL('https://evil.example/api/v1/webhooks/x')),
    ).toBe(false)
  })

  it('production refuses Activepieces without webhook secret', () => {
    process.env.NODE_ENV = 'production'
    process.env.FLOWS_TRIGGER_REQUIRE_AUTH = 'true'
    delete process.env.N8N_BASE_URL
    delete process.env.N8N_WEBHOOK_URL
    delete process.env.N8N_WEBHOOK_SECRET
    process.env.ACTIVEPIECES_BASE_URL = 'http://activepieces:80'
    delete process.env.ACTIVEPIECES_WEBHOOK_SECRET
    expect(() => assertProductionFlowAuthConfig()).toThrow(/ACTIVEPIECES_WEBHOOK_SECRET/)
    process.env.N8N_WEBHOOK_SECRET = 'shared-secret'
    expect(() => assertProductionFlowAuthConfig()).not.toThrow()
  })

  it('warns in non-production when Activepieces secret is missing', () => {
    process.env.NODE_ENV = 'development'
    process.env.ACTIVEPIECES_BASE_URL = 'http://activepieces:80'
    delete process.env.ACTIVEPIECES_WEBHOOK_SECRET
    delete process.env.N8N_WEBHOOK_SECRET
    const warn = vi.fn()
    warnIfActivepiecesWebhookSecretMissing({ warn })
    expect(warn).toHaveBeenCalledOnce()
    process.env.ACTIVEPIECES_WEBHOOK_SECRET = 'x'
    warn.mockClear()
    warnIfActivepiecesWebhookSecretMissing({ warn })
    expect(warn).not.toHaveBeenCalled()
  })
})
