/**
 * Strip absolute URLs and credential-like substrings from flow error text
 * before failed-run records, emails, and console warnings.
 */
const ABSOLUTE_URL =
  /https?:\/\/[^\s"'<>)\]},]+/gi
const BEARER =
  /\bBearer\s+[A-Za-z0-9._\-+=\/]+/gi
const BASIC =
  /\bBasic\s+[A-Za-z0-9+/=]+/gi
const QUERY_SECRET =
  /([?&](?:access_token|api[_-]?key|auth|password|secret|token)=)[^&\s"'<>)\]},]+/gi
const HEADER_STYLE =
  /\b((?:x-)?(?:api[_-]?key|authorization|token|secret|password)\s*[:=]\s*)([^\s,;]+)/gi

export function sanitizeFlowErrorMessage(message: string | null | undefined): string {
  let out = String(message ?? '')
  if (!out) return out
  out = out.replace(ABSOLUTE_URL, '[url]')
  out = out.replace(BEARER, 'Bearer [redacted]')
  out = out.replace(BASIC, 'Basic [redacted]')
  out = out.replace(QUERY_SECRET, '$1[redacted]')
  out = out.replace(HEADER_STYLE, '$1[redacted]')
  return out
}
