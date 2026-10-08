interface ApiErrorEntry {
  message?: string
  extensions?: { code?: string }
}

interface ApiErrorShape {
  message?: string
  errors?: ApiErrorEntry[]
}

export function apiErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') {
    return err instanceof Error ? err.message : fallback
  }

  const error = err as ApiErrorShape
  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message
  }

  const messages = (error.errors ?? [])
    .map((entry) => entry.message?.trim())
    .filter((message): message is string => Boolean(message))

  if (messages.length) {
    return messages.join(' ')
  }

  return fallback
}
