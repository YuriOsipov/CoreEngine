/**
 * Caps for server document PDF/HTML render (timeout, concurrency, output size).
 * Env:
 *   DOC_RENDER_TIMEOUT_MS (default 30000)
 *   DOC_RENDER_MAX_CONCURRENCY (default 2)
 *   DOC_RENDER_MAX_OUTPUT_BYTES (default 25 MiB)
 */

const MB = 1024 * 1024

function envInt(name: string, fallback: number, min: number): number {
  const n = Number(process.env[name])
  if (!Number.isFinite(n) || n < min) return fallback
  return Math.floor(n)
}

export function renderTimeoutMs(): number {
  return envInt('DOC_RENDER_TIMEOUT_MS', 30_000, 1_000)
}

export function renderMaxConcurrency(): number {
  return envInt('DOC_RENDER_MAX_CONCURRENCY', 2, 1)
}

export function renderMaxOutputBytes(): number {
  return envInt('DOC_RENDER_MAX_OUTPUT_BYTES', 25 * MB, 64 * 1024)
}

let active = 0
const waiters: Array<() => void> = []

function releaseSlot(): void {
  active = Math.max(0, active - 1)
  const next = waiters.shift()
  if (next) next()
}

async function acquireSlot(): Promise<void> {
  if (active < renderMaxConcurrency()) {
    active += 1
    return
  }
  await new Promise<void>((resolve) => {
    waiters.push(() => {
      active += 1
      resolve()
    })
  })
}

export async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot()
  try {
    return await fn()
  } finally {
    releaseSlot()
  }
}

/**
 * Promise.race timeout only — does **not** stop in-flight work.
 * Production PDF/HTML render uses `renderDocumentInWorker` (worker.terminate).
 * Kept for unit tests of the race helper itself.
 */
export async function withRenderTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs = renderTimeoutMs(),
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Document render timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function assertRenderOutputSize(
  buffer: Buffer,
  maxBytes = renderMaxOutputBytes(),
): void {
  if (buffer.length > maxBytes) {
    throw new Error(
      `Document render output exceeds limit (${buffer.length} > ${maxBytes} bytes)`,
    )
  }
}

/** Test helper — reset concurrency queue between unit tests. */
export function resetRenderSlotStateForTests(): void {
  active = 0
  waiters.length = 0
}
