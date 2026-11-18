/**
 * Fail-closed audit after a mutating write.
 * Runs compensate (best-effort reverse) when audit fails, then rethrows.
 */
export async function auditAfterMutation(input: {
  audit: () => Promise<void>
  compensate?: () => Promise<void>
}): Promise<void> {
  try {
    await input.audit()
  } catch (error) {
    if (input.compensate) {
      try {
        await input.compensate()
      } catch (compensateError) {
        console.error('[audit] compensate after audit failure failed', compensateError)
      }
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
}
