/**
 * Run DocEngine PDF/HTML render in a worker_threads Worker.
 * On timeout the worker is terminated (hard kill), not just Promise.raced away.
 * V8 heap/stack caps come from renderWorkerResourceLimits().
 */
import { Worker, type ResourceLimits } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import {
  renderTimeoutMs,
  renderWorkerResourceLimits,
} from './renderLimits.js'

export type RenderInWorkerInput = {
  template: Record<string, unknown>
  document: Record<string, unknown>
  outputFormat: 'pdf' | 'html'
  title?: string | null
}

export type RenderInWorkerResult = {
  buffer: Buffer
  mimeType: string
  filename: string
}

const defaultWorkerUrl = new URL('./renderWorkerThread.mjs', import.meta.url)

export type RunRenderWorkerOptions = {
  timeoutMs?: number
  /** Override worker module (tests). */
  workerUrl?: URL | string
  workerData?: unknown
  /** Override V8 resourceLimits (tests). */
  resourceLimits?: ResourceLimits
}

/**
 * Spawn a worker, wait for a single result message, terminate on timeout.
 */
export function runRenderWorker(
  options: RunRenderWorkerOptions & { workerData: unknown },
): Promise<RenderInWorkerResult> {
  const timeoutMs = options.timeoutMs ?? renderTimeoutMs()
  const resourceLimits =
    options.resourceLimits ?? renderWorkerResourceLimits()
  const workerPath =
    typeof options.workerUrl === 'string'
      ? options.workerUrl
      : fileURLToPath(options.workerUrl ?? defaultWorkerUrl)

  return new Promise<RenderInWorkerResult>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const worker = new Worker(workerPath, {
      workerData: options.workerData,
      resourceLimits,
    })

    const finish = (err: Error | null, result?: RenderInWorkerResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      void worker.terminate().catch(() => undefined)
      if (err) reject(err)
      else if (result) resolve(result)
      else reject(new Error('Document render worker returned no result'))
    }

    timer = setTimeout(() => {
      finish(new Error(`Document render timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    worker.on('message', (msg: unknown) => {
      const payload = msg as {
        ok?: boolean
        error?: string
        buffer?: Buffer | Uint8Array | ArrayBuffer
        mimeType?: string
        filename?: string
      }
      if (!payload || payload.ok !== true) {
        finish(
          new Error(
            payload?.error
              ? String(payload.error)
              : 'Document render worker failed',
          ),
        )
        return
      }
      const raw = payload.buffer
      const buffer = Buffer.isBuffer(raw)
        ? raw
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw)
          : Buffer.from(raw ?? [])
      finish(null, {
        buffer,
        mimeType: String(payload.mimeType || 'application/octet-stream'),
        filename: String(payload.filename || 'document'),
      })
    })

    worker.on('error', (error) => {
      finish(error instanceof Error ? error : new Error(String(error)))
    })

    worker.on('exit', (code) => {
      if (settled) return
      if (code === 0) {
        finish(new Error('Document render worker exited before sending a result'))
        return
      }
      // Non-zero often means terminate() after timeout — prefer timeout error if racing.
      finish(new Error(`Document render worker exited with code ${code}`))
    })
  })
}

export async function renderDocumentInWorker(
  input: RenderInWorkerInput,
  timeoutMs = renderTimeoutMs(),
): Promise<RenderInWorkerResult> {
  return runRenderWorker({
    timeoutMs,
    workerData: {
      template: input.template,
      document: input.document,
      outputFormat: input.outputFormat,
      title: input.title ?? 'document',
    },
  })
}
