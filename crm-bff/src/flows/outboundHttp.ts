/**
 * SSRF guard for admin-configured HTTP flow URLs.
 * - http(s) only, no credentials in the URL
 * - destination IPs checked at connect time (pinned lookup → no DNS rebinding)
 * - redirects followed manually and re-validated (max 3)
 * Private / loopback targets need FLOWS_HTTP_ALLOWED_HOSTS (e.g. "n8n,localhost:5678")
 * or the host of N8N_WEBHOOK_URL.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { Agent, fetch, type Response } from 'undici'

const MAX_REDIRECTS = 3
const REQUEST_TIMEOUT_MS = 15_000

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return blocked.check(address, 'ipv4')
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
    if (mapped) return blocked.check(mapped[1]!, 'ipv4')
    return blocked.check(address, 'ipv6')
  }
  return true
}

function allowedPrivateHosts(): Set<string> {
  const out = new Set<string>()
  for (const raw of (process.env.FLOWS_HTTP_ALLOWED_HOSTS || '').split(',')) {
    const value = raw.trim().toLowerCase()
    if (value) out.add(value)
  }
  const n8n = (process.env.N8N_WEBHOOK_URL || '').trim()
  if (n8n) {
    try {
      out.add(new URL(n8n).host.toLowerCase())
    } catch {
      // ignore malformed env
    }
  }
  return out
}

function hostAllowsPrivate(url: URL): boolean {
  const allowed = allowedPrivateHosts()
  return allowed.has(url.host.toLowerCase()) || allowed.has(url.hostname.toLowerCase())
}

export function assertOutboundUrlShape(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Flow URL is not a valid absolute URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Flow URL must use http or https')
  }
  if (url.username || url.password) {
    throw new Error('Flow URL must not embed credentials (use flow auth settings)')
  }
  return url
}

function guardedAgent(allowPrivate: boolean): Agent {
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
          if (error) {
            callback(error, '', 0)
            return
          }
          const list = (Array.isArray(addresses) ? addresses : []) as LookupAddress[]
          const usable = allowPrivate ? list : list.filter((a) => !isBlockedAddress(a.address))
          if (!usable.length) {
            callback(
              Object.assign(new Error(`Flow URL host "${hostname}" resolves to a blocked address`), {
                code: 'EBLOCKEDADDRESS',
              }),
              '',
              0,
            )
            return
          }
          if ((options as { all?: boolean }).all) {
            ;(callback as unknown as (e: null, a: LookupAddress[]) => void)(null, usable)
          } else {
            callback(null, usable[0]!.address, usable[0]!.family)
          }
        })
      },
    },
  })
}

/**
 * fetch() for flow handlers. `headersFor(url)` is re-evaluated per hop so
 * secrets can be scoped to the original origin.
 */
export async function guardedFlowFetch(
  rawUrl: string,
  init: { method: string; body?: string },
  headersFor: (url: URL) => Record<string, string>,
): Promise<Response> {
  let url = assertOutboundUrlShape(rawUrl)
  let method = init.method
  let body = init.body
  for (let hop = 0; ; hop += 1) {
    const allowPrivate = hostAllowsPrivate(url)
    if (!allowPrivate && isIP(url.hostname.replace(/^\[|\]$/g, '')) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
      throw new Error(`Flow URL host "${url.hostname}" is a blocked address`)
    }
    const dispatcher = guardedAgent(allowPrivate)
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: headersFor(url),
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'manual',
        dispatcher,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } finally {
      void dispatcher.close()
    }
    if (response.status < 300 || response.status >= 400 || response.status === 304) {
      return response
    }
    const location = response.headers.get('location')
    if (!location) return response
    if (hop >= MAX_REDIRECTS) throw new Error('Flow URL redirected too many times')
    url = assertOutboundUrlShape(new URL(location, url).toString())
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET'
      body = undefined
    }
  }
}
