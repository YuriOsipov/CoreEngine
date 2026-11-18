import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { runRenderWorker } from './renderInWorker.js'

describe('renderInWorker hard kill', () => {
  it('terminates a hung worker on timeout (not just Promise.race)', async () => {
    const hangUrl = fileURLToPath(new URL('./renderHangWorker.mjs', import.meta.url))
    const started = Date.now()
    await expect(
      runRenderWorker({
        workerUrl: hangUrl,
        workerData: {},
        timeoutMs: 40,
      }),
    ).rejects.toThrow(/timed out after 40ms/)
    expect(Date.now() - started).toBeLessThan(500)
  })
})
