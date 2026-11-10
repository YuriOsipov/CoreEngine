/**
 * Normalize configured webhook / path to a flow trigger key.
 * Accepts raw key, `/flows/trigger/{key}`, or absolute URL with that path.
 */
export function flowTriggerKeyFromWebhook(webhook: string): string {
  const trimmed = webhook.trim()
  if (!trimmed) return ''

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const match = url.pathname.match(/\/flows\/trigger\/([^/?#]+)/i)
      return match?.[1] ? decodeURIComponent(match[1]) : ''
    } catch {
      return ''
    }
  }

  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const match = path.match(/\/flows\/trigger\/([^/?#]+)/i)
  if (match?.[1]) return decodeURIComponent(match[1])

  return trimmed.replace(/^\/+/, '')
}
