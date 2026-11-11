/**
 * Collections whose live data lives in dedicated registry tables
 * (`layout_settings`, `user_settings`, `recent_record_views`), not
 * `crm_schema` / `business_records`. Registry `backend_target` is `PLATFORM`.
 *
 * CRM business entities live in `crm_schema.<api_name>` (see `crmStorage.ts`).
 * `public.business_records` is legacy JSONB only when `backend_config.storage=jsonb`.
 */
export const REGISTRY_PLATFORM_ENTITIES = new Set([
  'Setting',
  'user_setting',
  'recent_record_views',
])

/** Dev/CI smoke entity only — never treat as a production PLATFORM collection. */
export const REGISTRY_SMOKE_ENTITY = '_registry_smoke'

export function isRegistryPlatformEntity(apiName: string): boolean {
  return REGISTRY_PLATFORM_ENTITIES.has(apiName)
}

export function isPlatformBackendTarget(backendTarget: string | null | undefined): boolean {
  return String(backendTarget || '').toUpperCase() === 'PLATFORM'
}
