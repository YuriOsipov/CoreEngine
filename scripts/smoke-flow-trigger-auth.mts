/**
 * Smoke authorizeFlowTrigger (JWT / service key / automation re-entry).
 * Does not require a running BFF HTTP process.
 *
 * Usage: npm run registry:smoke-flow-trigger-auth
 */
import { signAccessToken } from '../crm-bff/src/auth/jwt.ts'
import {
  authorizeFlowTrigger,
  CRM_AUTOMATION_HEADER,
  CRM_FLOW_SECRET_HEADER,
} from '../crm-bff/src/flows/flowAuth.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const prevRequire = process.env.FLOWS_TRIGGER_REQUIRE_AUTH
const prevService = process.env.FLOWS_TRIGGER_SERVICE_KEY
const prevReentry = process.env.FLOWS_REJECT_AUTOMATION_REENTRY

try {
  process.env.FLOWS_TRIGGER_REQUIRE_AUTH = 'true'
  process.env.FLOWS_TRIGGER_SERVICE_KEY = 'test-service-key-abcdefghijklmnopqrstuvwxyz'
  process.env.FLOWS_REJECT_AUTOMATION_REENTRY = 'true'

  const denied = authorizeFlowTrigger({ authorizationHeader: undefined })
  assert(!denied.ok && denied.status === 401, 'expected 401 without auth')
  console.log('ok: require auth → 401')

  const jwt = signAccessToken({ id: '00000000-0000-4000-8000-000000000001', adminAccess: true })
  const viaJwt = authorizeFlowTrigger({
    authorizationHeader: `Bearer ${jwt}`,
  })
  assert(viaJwt.ok && viaJwt.via === 'jwt', 'expected jwt auth')
  console.log('ok: jwt bearer')

  const viaServiceBearer = authorizeFlowTrigger({
    authorizationHeader: `Bearer ${process.env.FLOWS_TRIGGER_SERVICE_KEY}`,
  })
  assert(viaServiceBearer.ok && viaServiceBearer.via === 'service_key', 'expected service_key bearer')
  console.log('ok: service key bearer')

  const viaSecretHeader = authorizeFlowTrigger({
    authorizationHeader: undefined,
    headers: { [CRM_FLOW_SECRET_HEADER]: process.env.FLOWS_TRIGGER_SERVICE_KEY },
  })
  assert(viaSecretHeader.ok && viaSecretHeader.via === 'service_key', 'expected service_key header')
  console.log('ok: service key header')

  const reentry = authorizeFlowTrigger({
    authorizationHeader: `Bearer ${jwt}`,
    headers: { [CRM_AUTOMATION_HEADER]: 'n8n' },
  })
  assert(!reentry.ok && reentry.status === 409, 'expected 409 automation re-entry')
  console.log('ok: reject automation re-entry')

  process.env.FLOWS_TRIGGER_REQUIRE_AUTH = 'false'
  const open = authorizeFlowTrigger({ authorizationHeader: undefined })
  assert(open.ok && open.via === 'open', 'expected open when require auth false')
  console.log('ok: open mode')

  console.log(JSON.stringify({ ok: true }, null, 2))
} finally {
  if (prevRequire === undefined) delete process.env.FLOWS_TRIGGER_REQUIRE_AUTH
  else process.env.FLOWS_TRIGGER_REQUIRE_AUTH = prevRequire
  if (prevService === undefined) delete process.env.FLOWS_TRIGGER_SERVICE_KEY
  else process.env.FLOWS_TRIGGER_SERVICE_KEY = prevService
  if (prevReentry === undefined) delete process.env.FLOWS_REJECT_AUTOMATION_REENTRY
  else process.env.FLOWS_REJECT_AUTOMATION_REENTRY = prevReentry
}
