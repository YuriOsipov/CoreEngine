export type AppEnvironment = 'sandbox' | 'production'

/** Install flag. Unset means production. Not stored in snapshots. */
export function appEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): AppEnvironment {
  return String(env.APP_ENV || '').trim().toLowerCase() === 'sandbox'
    ? 'sandbox'
    : 'production'
}

export function isSandboxEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return appEnvironment(env) === 'sandbox'
}

export function healthBody(
  dbOk: boolean,
  env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; service: string; environment: AppEnvironment } {
  return {
    ok: dbOk,
    service: 'crm-bff',
    environment: appEnvironment(env),
  }
}
