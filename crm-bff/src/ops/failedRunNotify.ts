/**
 * Optional email when an in-process flow or scheduled task fails.
 *
 * Enable with Setup → General → "Email admins on failed runs", or set
 * FAILED_RUN_NOTIFY_EMAIL (comma-separated). Needs SMTP_HOST + SMTP_FROM.
 * Debounced per kind+key (15 minutes) so a flapping job does not flood inboxes.
 */
import { query } from '../db/pool.js'
import {
  isPlatformMailConfigured,
  sendPlatformMail,
} from '../mail/platformMail.js'
import { getOrgSetting } from '../services/orgSettingsService.js'

export const FAILED_RUN_NOTIFY_SETTING_KEY = 'ops.failed_run_notify'

const DEBOUNCE_MS = 15 * 60_000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const lastSent = new Map<string, number>()

export type FailedRunNotifyKind = 'flow' | 'task'

export interface FailedRunNotifyInput {
  kind: FailedRunNotifyKind
  key: string
  error: string
  detail?: string
}

function envEmails(): string[] {
  const raw = (process.env.FAILED_RUN_NOTIFY_EMAIL || '').trim()
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => EMAIL_RE.test(part))
}

function envForceEnabled(): boolean {
  const raw = (process.env.FAILED_RUN_NOTIFY || '').trim().toLowerCase()
  if (raw === 'true' || raw === '1' || raw === 'on') return true
  return envEmails().length > 0
}

function parseOrgEnabled(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Boolean((value as { enabled?: unknown }).enabled)
}

async function isNotifyEnabled(): Promise<boolean> {
  if (envForceEnabled()) return true
  try {
    return parseOrgEnabled(await getOrgSetting(FAILED_RUN_NOTIFY_SETTING_KEY))
  } catch {
    return false
  }
}

async function listAdminEmails(): Promise<string[]> {
  const rows = await query<{ email: string }>(
    `SELECT DISTINCT lower(u.email) AS email
     FROM public.app_users u
     JOIN public.app_roles r ON r.id = u.role_id
     WHERE u.is_active = true
       AND r.is_admin = true
       AND u.email IS NOT NULL
       AND length(trim(u.email)) > 0`,
  )
  return rows
    .map((row) => String(row.email || '').trim().toLowerCase())
    .filter((email) => EMAIL_RE.test(email))
}

async function resolveRecipients(): Promise<string[]> {
  const fromEnv = envEmails()
  if (fromEnv.length) return [...new Set(fromEnv)]
  try {
    return [...new Set(await listAdminEmails())]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[failedRunNotify] could not load admin emails:', message)
    return []
  }
}

function shouldSend(kind: FailedRunNotifyKind, key: string): boolean {
  const stamp = `${kind}:${key}`
  const now = Date.now()
  const previous = lastSent.get(stamp) ?? 0
  if (now - previous < DEBOUNCE_MS) return false
  lastSent.set(stamp, now)
  return true
}

/** Fire-and-forget. Never throws to the failure path. */
export function scheduleFailedRunNotify(input: FailedRunNotifyInput): void {
  void notifyFailedRun(input)
}

export async function notifyFailedRun(input: FailedRunNotifyInput): Promise<void> {
  try {
    if (!isPlatformMailConfigured()) return
    if (!(await isNotifyEnabled())) return
    const key = input.key.trim() || '(missing)'
    if (!shouldSend(input.kind, key)) return

    const recipients = await resolveRecipients()
    if (!recipients.length) {
      console.warn(
        '[failedRunNotify] enabled but no recipients (set FAILED_RUN_NOTIFY_EMAIL or assign an admin user email)',
      )
      return
    }

    const kindLabel = input.kind === 'flow' ? 'Flow' : 'Scheduled task'
    const subject = `CoreEngine ${kindLabel} failed: ${key}`.slice(0, 180)
    const lines = [
      `${kindLabel} failed in CoreEngine.`,
      '',
      `Key: ${key}`,
      `Error: ${input.error.slice(0, 2000)}`,
    ]
    if (input.detail) lines.push(`Detail: ${input.detail.slice(0, 1000)}`)
    lines.push(
      '',
      'Open Setup → External Flows / Tasks → Failed runs for recent history.',
      'n8n execution errors are separate — use the failed-execution alert template there.',
    )
    const text = lines.join('\n')

    for (const to of recipients) {
      try {
        await sendPlatformMail({ to, subject, text })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[failedRunNotify] mail to ${to} failed: ${message}`)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[failedRunNotify] unexpected error:', message)
  }
}

/** Test helper — clears the in-process debounce map. */
export function resetFailedRunNotifyDebounce(): void {
  lastSent.clear()
}
