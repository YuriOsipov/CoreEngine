import { createTransport, type Transporter } from 'nodemailer'

/**
 * In-process SMTP for mail the product itself must send (invite, password reset, login code).
 * Record, document, and automation email stays in n8n. There is no public send route.
 */

export class PlatformMailNotConfiguredError extends Error {
  constructor() {
    super('Platform mail is not configured (set SMTP_HOST and SMTP_FROM)')
    this.name = 'PlatformMailNotConfiguredError'
  }
}

export type PlatformMailConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
}

export type PlatformMailInput = {
  to: string
  subject: string
  text: string
  html?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function env(name: string): string {
  return (process.env[name] || '').trim()
}

export function readPlatformMailConfig(): PlatformMailConfig | null {
  const host = env('SMTP_HOST')
  const from = env('SMTP_FROM') || env('SMTP_USER')
  if (!host || !from) return null

  const portRaw = env('SMTP_PORT')
  const port = portRaw ? Number(portRaw) : 587
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid SMTP_PORT: ${portRaw}`)
  }

  const secureRaw = env('SMTP_SECURE').toLowerCase()
  const secure =
    secureRaw === 'true' ||
    secureRaw === '1' ||
    (secureRaw === '' && port === 465)

  return {
    host,
    port,
    secure,
    user: env('SMTP_USER'),
    password: process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '',
    from,
  }
}

export function isPlatformMailConfigured(): boolean {
  try {
    return readPlatformMailConfig() !== null
  } catch {
    return false
  }
}

/** One-line boot status. Never includes credentials. */
export function describePlatformMail(): string {
  try {
    const config = readPlatformMailConfig()
    if (!config) return 'Platform mail: not configured (set SMTP_HOST and SMTP_FROM)'
    return `Platform mail: ${config.host}:${config.port} from ${config.from}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Platform mail: ${message}`
  }
}

let transporter: Transporter | null = null
let transporterKey = ''

function getTransporter(config: PlatformMailConfig): Transporter {
  const key = `${config.host}|${config.port}|${config.secure}|${config.user}`
  if (transporter && transporterKey === key) return transporter
  transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  transporterKey = key
  return transporter
}

export async function sendPlatformMail(
  input: PlatformMailInput,
): Promise<{ messageId: string }> {
  const config = readPlatformMailConfig()
  if (!config) throw new PlatformMailNotConfiguredError()

  const to = input.to.trim()
  const subject = input.subject.trim()
  const text = input.text.trim()
  if (!EMAIL_RE.test(to) || /[\r\n]/.test(to)) {
    throw new Error('Platform mail recipient is not a valid email')
  }
  if (!subject || /[\r\n]/.test(subject)) {
    throw new Error('Platform mail subject is required')
  }
  if (!text) throw new Error('Platform mail text body is required')

  const html = input.html?.trim()
  const info = await getTransporter(config).sendMail({
    from: config.from,
    to,
    subject,
    text,
    html: html || undefined,
  })
  return { messageId: String(info.messageId || '') }
}
