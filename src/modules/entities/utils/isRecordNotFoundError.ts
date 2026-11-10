/** True when the BFF/GraphQL error is a missing business record (`Record not found: collection/id`). */
export function isRecordNotFoundError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return /Record not found:/i.test(err.message)
}
