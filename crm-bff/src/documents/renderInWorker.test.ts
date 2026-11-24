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

  it(
    'kills a worker that exceeds resourceLimits heap',
    async () => {
      const oomUrl = fileURLToPath(new URL('./renderOomWorker.mjs', import.meta.url))
      await expect(
        runRenderWorker({
          workerUrl: oomUrl,
          workerData: {},
          timeoutMs: 8_000,
          resourceLimits: {
            maxOldGenerationSizeMb: 16,
            stackSizeMb: 1,
          },
        }),
      ).rejects.toThrow(/memory|heap|exited|oom/i)
    },
    15_000,
  )
})
