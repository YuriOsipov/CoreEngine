export class SnapshotHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SnapshotHttpError'
    this.status = status
  }
}
