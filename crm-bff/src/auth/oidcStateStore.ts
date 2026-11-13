/**
 * In-process PKCE/state + one-time session tickets.
 * Multi-instance BFF needs sticky sessions or a shared store — document in README.
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
  createdAt: number
}

const PENDING_TTL_MS = 10 * 60_000
const TICKET_TTL_MS = 60_000

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

export function storeOidcPending(state: string, pending: Omit<OidcPendingAuth, 'createdAt'>): void {
  prune()
  pendingByState.set(state, { ...pending, createdAt: Date.now() })
}

export function takeOidcPending(state: string): OidcPendingAuth | null {
  prune()
  const pending = pendingByState.get(state) ?? null
  if (pending) pendingByState.delete(state)
  if (!pending) return null
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) return null
  return pending
}

export function storeOidcSessionTicket(
  ticketId: string,
  session: Omit<OidcSessionTicket, 'createdAt'>,
): void {
  prune()
  ticketsById.set(ticketId, { ...session, createdAt: Date.now() })
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
