import { SnapshotHttpError } from './errors.js'

export const MIGRATE_PRODUCTION_MESSAGE =
  'Run registry:migrate on Production before promoting this snapshot.'

export const MIGRATE_SANDBOX_MESSAGE =
  'Run registry:migrate on the sandbox before promoting this snapshot, then export again.'

export function normalizeMigrationList(filenames: readonly string[]): string[] {
  return [...new Set(filenames.map((name) => String(name || '').trim()).filter(Boolean))].sort()
}

export type KernelCompare =
  | { ok: true }
  | { ok: false; message: string; extra: string[] }

/** Deploy only when both databases have applied the same migration files. */
export function compareKernelMigrations(
  snapshotMigrations: readonly string[],
  targetMigrations: readonly string[],
): KernelCompare {
  const snapshot = new Set(normalizeMigrationList(snapshotMigrations))
  const target = new Set(normalizeMigrationList(targetMigrations))
  const snapshotAhead = [...snapshot].filter((name) => !target.has(name)).sort()
  const targetAhead = [...target].filter((name) => !snapshot.has(name)).sort()
  if (snapshotAhead.length) {
    return { ok: false, message: MIGRATE_PRODUCTION_MESSAGE, extra: snapshotAhead }
  }
  if (targetAhead.length) {
    return { ok: false, message: MIGRATE_SANDBOX_MESSAGE, extra: targetAhead }
  }
  return { ok: true }
}

export function assertKernelMatch(
  snapshotMigrations: readonly string[],
  targetMigrations: readonly string[],
): void {
  const compared = compareKernelMigrations(snapshotMigrations, targetMigrations)
  if (!compared.ok) {
    const extra = compared.extra.length ? ` ${compared.extra.join(', ')}` : ''
    throw new SnapshotHttpError(409, `${compared.message}${extra}`)
  }
}
