/**
 * Local flow triggers only (`app_flow_triggers`). Legacy remote flow proxy retired.
 */
import { authorizeFlowTrigger } from './flowAuth.js'
import { LocalFlowError, runLocalFlow, type LocalFlowResult } from './localFlows.js'

export type FlowsBackend = 'local'

export function resolveFlowsBackend(): FlowsBackend {
  const raw = (process.env.FLOWS_BACKEND || '').trim().toLowerCase()
  if (raw === 'directus') {
    throw new Error(
      'FLOWS_BACKEND=directus was retired. Use FLOWS_BACKEND=local / app_flow_triggers.',
    )
  }
  return 'local'
}

export async function triggerFlow(
  key: string,
  payload: unknown,
  authorizationHeader: string | undefined,
  headers?: Record<string, string | string[] | undefined>,
): Promise<{ status: number; body: unknown }> {
  const trimmed = key.trim()
  if (!trimmed) {
    return { status: 400, body: { error: 'flow trigger key is required' } }
  }

  // Ensure misconfigured env fails loudly before running.
  resolveFlowsBackend()

  const auth = authorizeFlowTrigger({
    authorizationHeader,
    headers,
  })
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } }
  }

  try {
    const result: LocalFlowResult = await runLocalFlow(trimmed, payload)
    return {
      status: 200,
      body: {
        ...result,
        auth: { via: auth.via, actorId: auth.actorId },
      },
    }
  } catch (error) {
    if (error instanceof LocalFlowError) {
      return { status: error.status, body: { error: error.message } }
    }
    const message = error instanceof Error ? error.message : 'Local flow failed'
    return { status: 500, body: { error: message } }
  }
}
