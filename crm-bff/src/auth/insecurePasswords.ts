/**
 * Well-known / docs example passwords. Production BFF refuses to start when any
 * bootstrap account still verifies against these. Local provision may set them
 * temporarily with must_change_password=true.
 */
export const KNOWN_INSECURE_PASSWORDS = [
  'admin12345',
  'password',
  'password123',
  'ChangeMeNow!',
  'changeme',
  'crm-local-dev',
] as const

export const BOOTSTRAP_EMAILS = ['admin@example.com', 'user@example.com'] as const

export function isInsecurePassword(password: string): boolean {
  const trimmed = password.trim()
  if (!trimmed) return true
  if (KNOWN_INSECURE_PASSWORDS.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
    return true
  }
  // Docs / placeholders that end with change-me style suffixes.
  if (/change-?me!?$/i.test(trimmed)) return true
  return false
}
