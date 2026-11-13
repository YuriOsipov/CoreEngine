/**
 * In-process PKCE/state + one-time session tickets.
 * Multi-instance BFF needs sticky sessions or a shared store — see docs/oidc-sso.md.
 */

export interface OidcPendingAuth {
  codeVerifier: string
  nonce: string
  /** Safe in-app path after login (e.g. / or /setup). */
  redirectPath: string
  createdAt: number
}

export interface OidcSessionTicket {
  access_token: string
  refresh_token: string
  expires: number
  must_change_password?: boolean
  /** IdP ID token for RP-initiated logout (`id_token_hint`). */
  id_token?: string
  createdAt: number
}

const PENDING_TTL_MS = 10 * 60_000
const TICKET_TTL_MS = 60_000
/** Cap pending PKCE entries so a multi-IP flood cannot grow unbounded (rate limit is per IP). */
const MAX_PENDING = 5_000
/** Cap one-time session tickets (short TTL; still bound memory). */
const MAX_TICKETS = 5_000

const pendingByState = new Map<string, OidcPendingAuth>()
const ticketsById = new Map<string, OidcSessionTicket>()

function prune(): void {
  const now = Date.now()
  for (const [key, value] of pendingByState) {
    if (now - value.createdAt > PENDING_TTL_MS) pendingByState.delete(key)
  }
  for (const [key, value] of ticketsById) {
    if (now - value.createdAt > TICKET_TTL_MS) ticketsById.delete(key)
  }
}

/**
 * Store PKCE pending auth. Returns false when the store is at capacity
 * (caller should fail closed with 503).
 */
export function storeOidcPending(
  state: string,
  pending: Omit<OidcPendingAuth, 'createdAt'>,
): boolean {
  prune()
  if (pendingByState.size >= MAX_PENDING) return false
  pendingByState.set(state, { ...pending, createdAt: Date.now() })
  return true
}

export function takeOidcPending(state: string): OidcPendingAuth | null {
  prune()
  const pending = pendingByState.get(state) ?? null
  if (pending) pendingByState.delete(state)
  if (!pending) return null
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) return null
  return pending
}

/**
 * Store one-time session ticket. Returns false when at capacity.
 */
export function storeOidcSessionTicket(
  ticketId: string,
  session: Omit<OidcSessionTicket, 'createdAt'>,
): boolean {
  prune()
  if (ticketsById.size >= MAX_TICKETS) return false
  ticketsById.set(ticketId, { ...session, createdAt: Date.now() })
  return true
}

export function takeOidcSessionTicket(ticketId: string): OidcSessionTicket | null {
  prune()
  const ticket = ticketsById.get(ticketId) ?? null
  if (ticket) ticketsById.delete(ticketId)
  if (!ticket) return null
  if (Date.now() - ticket.createdAt > TICKET_TTL_MS) return null
  return ticket
}

/** Test helper — clear stores between tests. */
export function resetOidcStateStores(): void {
  pendingByState.clear()
  ticketsById.clear()
}

/** Test helper. */
export function oidcPendingStoreSize(): number {
  return pendingByState.size
}

/** Test helper. */
export function oidcTicketStoreSize(): number {
  return ticketsById.size
}

/** Test helper — expose caps. */
export function oidcStoreCaps(): { maxPending: number; maxTickets: number } {
  return { maxPending: MAX_PENDING, maxTickets: MAX_TICKETS }
}
