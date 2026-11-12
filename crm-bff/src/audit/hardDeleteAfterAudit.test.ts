import { describe, expect, it, vi } from 'vitest'
import { hardDeleteAfterAudit } from './hardDeleteAfterAudit.js'

describe('hardDeleteAfterAudit', () => {
  it('runs audit before delete', async () => {
    const order: string[] = []
    await hardDeleteAfterAudit({
      audit: async () => {
        order.push('audit')
      },
      delete: async () => {
        order.push('delete')
      },
    })
    expect(order).toEqual(['audit', 'delete'])
  })

  it('does not delete when audit fails', async () => {
    const deleteFn = vi.fn(async () => undefined)
    await expect(
      hardDeleteAfterAudit({
        audit: async () => {
          throw new Error('audit down')
        },
        delete: deleteFn,
      }),
    ).rejects.toThrow('audit down')
    expect(deleteFn).not.toHaveBeenCalled()
  })
})
