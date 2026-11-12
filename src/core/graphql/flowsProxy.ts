import { getAccessToken } from '@/core/auth/session'
import { featureFlags, refuseLegacyFallback } from './featureFlags'
import { bffBaseUrl } from './filesProxy'

export function canUseFlowsProxy(): boolean {
  return featureFlags.recordsFromGraphQL
}

/**
 * Normalize configured webhook to a flow trigger key.
 * Accepts raw key, `/flows/trigger/{key}`, or absolute URL with that path.
 */
export function flowTriggerKeyFromWebhook(webhook: string): string {
  const trimmed = webhook.trim()
  if (!trimmed) return ''

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed)
    const match = url.pathname.match(/\/flows\/trigger\/([^/?#]+)/i)
    return match?.[1] ? decodeURIComponent(match[1]) : ''
  }

  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const match = path.match(/\/flows\/trigger\/([^/?#]+)/i)
  if (match?.[1]) return decodeURIComponent(match[1])

  return trimmed.replace(/^\/+/, '')
}

export async function triggerFlowViaBff(
  webhook: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const key = flowTriggerKeyFromWebhook(webhook)
  if (!key) {
    throw new Error('Flow webhook is not configured for this action.')
  }

  const token = await getAccessToken()
  const { rolePreviewRequestHeaders } = await import('@/core/rolePreview')
  const response = await fetch(
    `${bffBaseUrl()}/flows/trigger/${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...rolePreviewRequestHeaders(),
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    },
  )

  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | { error?: string }
    | null

  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error?: string }).error || '')
        : ''
    throw new Error(message || `BFF flow trigger HTTP ${response.status}`)
  }

  return body ?? { ok: true }
}

/** Trigger a flow — BFF only. */
export async function triggerFlow(
  webhook: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (!canUseFlowsProxy()) {
    refuseLegacyFallback('triggerFlow')
  }
  return triggerFlowViaBff(webhook, payload)
}
