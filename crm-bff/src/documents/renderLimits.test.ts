import { afterEach, describe, expect, it } from 'vitest'
import {
  assertRenderOutputSize,
  resetRenderSlotStateForTests,
  withRenderSlot,
  withRenderTimeout,
} from './renderLimits.js'

describe('renderLimits', () => {
  afterEach(() => {
    resetRenderSlotStateForTests()
    delete process.env.DOC_RENDER_TIMEOUT_MS
    delete process.env.DOC_RENDER_MAX_CONCURRENCY
    delete process.env.DOC_RENDER_MAX_OUTPUT_BYTES
  })

  it('rejects oversized output', () => {
    process.env.DOC_RENDER_MAX_OUTPUT_BYTES = String(64 * 1024)
    expect(() => assertRenderOutputSize(Buffer.alloc(64 * 1024 + 1))).toThrow(
      /exceeds limit/,
    )
    expect(() => assertRenderOutputSize(Buffer.alloc(64 * 1024))).not.toThrow()
  })

  it('times out slow work', async () => {
    process.env.DOC_RENDER_TIMEOUT_MS = '20'
    await expect(
      withRenderTimeout(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
        20,
      ),
    ).rejects.toThrow(/timed out/)
  })

  it('serializes beyond max concurrency', async () => {
    process.env.DOC_RENDER_MAX_CONCURRENCY = '1'
    resetRenderSlotStateForTests()
    let concurrent = 0
    let peak = 0
    const run = () =>
      withRenderSlot(async () => {
        concurrent += 1
        peak = Math.max(peak, concurrent)
        await new Promise((r) => setTimeout(r, 30))
        concurrent -= 1
      })
    await Promise.all([run(), run(), run()])
    expect(peak).toBe(1)
  })

  it('keeps other async work (e.g. /health polls) responsive during a slow render', async () => {
    process.env.DOC_RENDER_MAX_CONCURRENCY = '1'
    process.env.DOC_RENDER_MAX_OUTPUT_BYTES = String(1024 * 1024)
    resetRenderSlotStateForTests()

    const healthTicks: number[] = []
    const started = Date.now()
    const pollHealth = async () => {
      for (let i = 0; i < 5; i += 1) {
        await new Promise((r) => setTimeout(r, 15))
        healthTicks.push(Date.now() - started)
      }
    }

    const largeRender = withRenderSlot(async () => {
      // Simulate a heavy template without blocking the event loop solidly:
      // yield periodically while holding the render slot.
      const chunks: Buffer[] = []
      for (let i = 0; i < 8; i += 1) {
        chunks.push(Buffer.alloc(32 * 1024, 1))
        await new Promise((r) => setTimeout(r, 20))
      }
      const buffer = Buffer.concat(chunks)
      assertRenderOutputSize(buffer)
      return buffer.length
    })

    const [, size] = await Promise.all([pollHealth(), largeRender])
    expect(size).toBeGreaterThan(0)
    expect(healthTicks.length).toBe(5)
    // Health polls must interleave while the render slot is held.
    expect(healthTicks[0]).toBeLessThan(80)
    expect(healthTicks[healthTicks.length - 1]).toBeLessThan(400)
  })
})
