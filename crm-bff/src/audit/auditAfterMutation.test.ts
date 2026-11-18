import { describe, expect, it, vi } from 'vitest'
import { auditAfterMutation } from './auditAfterMutation.js'

describe('auditAfterMutation', () => {
  it('succeeds when audit succeeds', async () => {
    const compensate = vi.fn(async () => undefined)
    await auditAfterMutation({
      audit: async () => undefined,
      compensate,
    })
    expect(compensate).not.toHaveBeenCalled()
  })

  it('runs compensate then rethrows when audit fails', async () => {
    const order: string[] = []
    await expect(
      auditAfterMutation({
        audit: async () => {
          order.push('audit')
          throw new Error('audit down')
        },
        compensate: async () => {
          order.push('compensate')
        },
      }),
    ).rejects.toThrow('audit down')
    expect(order).toEqual(['audit', 'compensate'])
  })

  it('still rethrows when compensate also fails', async () => {
    await expect(
      auditAfterMutation({
        audit: async () => {
          throw new Error('audit down')
        },
        compensate: async () => {
          throw new Error('compensate down')
        },
      }),
    ).rejects.toThrow('audit down')
  })
})
