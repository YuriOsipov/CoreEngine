export function createFieldFormModal(...args: unknown[]): {
  open(...args: unknown[]): void
  close(): void
  destroy(): void
}
