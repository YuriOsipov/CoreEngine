# Legacy Directus HTTP adapters — removed

Directus record/schema HTTP clients were deleted after the Supabase cutover.

- Live BFF: Supabase / PLATFORM only
- Auth: `AUTH_BACKEND=local`
- Flows: `app_flow_triggers` only
- `registry:import-directus` / `registry:migrate-directus-files` were **removed**
- `registry:migrate-entity-records` copies `business_records` → `crm_schema.<entity>` (Option C)

Historical Directus HTTP imports are out of scope; use backups outside this repo if still needed.
