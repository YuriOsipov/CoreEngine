/** Test-only worker that grows the V8 heap until resourceLimits kill it. */
import { parentPort } from 'node:worker_threads'

// Must allocate on the V8 heap (not Buffer/ArrayBuffer external memory).
const chunks = []
try {
  for (;;) {
    chunks.push(new Array(64 * 1024).fill(1))
  }
} catch {
  parentPort?.postMessage({ ok: false, error: 'oom-allocate-threw' })
}
