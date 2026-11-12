/**
 * Persist the DELETE audit row before the irreversible store delete.
 * If audit throws, the record is left intact.
 */
export async function hardDeleteAfterAudit(input: {
  audit: () => Promise<void>
  delete: () => Promise<void>
}): Promise<void> {
  await input.audit()
  await input.delete()
}
