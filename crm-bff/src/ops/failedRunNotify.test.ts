import { describe, expect, it } from 'vitest'

describe('failed run notify config parsing', () => {
  it('treats a non-empty FAILED_RUN_NOTIFY_EMAIL list as enable intent', async () => {
    const previous = process.env.FAILED_RUN_NOTIFY_EMAIL
    process.env.FAILED_RUN_NOTIFY_EMAIL = 'ops@example.com, admin@example.com'
    try {
      const { resetFailedRunNotifyDebounce } = await import('./failedRunNotify.js')
      resetFailedRunNotifyDebounce()
      // Import after env mutation so the module can read it at call time (env is read live).
      const emails = (process.env.FAILED_RUN_NOTIFY_EMAIL || '')
        .split(/[,;\s]+/)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
      expect(emails).toEqual(['ops@example.com', 'admin@example.com'])
    } finally {
      if (previous === undefined) delete process.env.FAILED_RUN_NOTIFY_EMAIL
      else process.env.FAILED_RUN_NOTIFY_EMAIL = previous
    }
  })
})
