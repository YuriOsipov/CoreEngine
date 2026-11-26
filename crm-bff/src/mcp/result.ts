/** Helpers for MCP tool return payloads. */

export function jsonToolResult(value: unknown): {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
} {
  return {
    content: [
      {
        type: 'text',
        text:
          typeof value === 'string'
            ? value
            : JSON.stringify(value, null, 2),
      },
    ],
  }
}

export function errorToolResult(error: unknown): {
  content: Array<{ type: 'text'; text: string }>
  isError: true
} {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}
