# CRM GraphQL BFF

GraphQL + HTTP API over the Supabase registry / `crm_schema` entity tables. Live records path is Supabase, PLATFORM, Hasura, or Directus GraphQL (`DIRECTUS_RUNTIME=off`).

## Run

```powershell
# from repo root
npm run bff:dev
# or
cd crm-bff
npm install
npm run dev
```

- GraphQL: http://localhost:4000/graphql
- Health: http://localhost:4000/health
- Auth: `POST /auth/login|refresh|logout` (`AUTH_BACKEND=local`)
- Files: `POST /files`, `PATCH /files/:id`, `GET /assets/:id` → Supabase Storage + `public.files`
- Flows: `POST /flows/trigger/:key` → local `app_flow_triggers` (`ack` | `http` | `update_record`)
  - Auth: JWT Bearer or `FLOWS_TRIGGER_SERVICE_KEY` (default required)
  - Outbound `http` handlers inject `X-CRM-Flow-Secret` / `X-CRM-Source` from `N8N_WEBHOOK_*`
  - Runbook: [docs/n8n-bff-flows.md](../docs/n8n-bff-flows.md)

Loads DB settings from `../supabase/.env` and `../.env`.

Hasura (optional records backend): `HASURA_GRAPHQL_URL` (default `http://localhost:8090/v1/graphql`) + `HASURA_ADMIN_SECRET`. Local Postgres (no Docker DB): create database `hasura` on `localhost:5434`, then `docker compose -f docs/hasura/docker-compose.yaml up -d`. Flip an entity with `npm run registry:set-entity-backend -- <api_name> HASURA`. Vue still uses `VITE_GRAPHQL_URL` (this BFF).

Directus (optional records backend, GraphQL only): `DIRECTUS_GRAPHQL_URL` (default `http://localhost:8055/graphql`) + `DIRECTUS_TOKEN`. Keep `DIRECTUS_RUNTIME=off` and do not set `VITE_DIRECTUS_TOKEN`. Flip an entity with `npm run registry:set-entity-backend -- <api_name> DIRECTUS`. Override collection / PK via `backend_config.directus` (`collection`, `idField` default `id`, `statusField` default `status`, optional `endpoint`).

## GraphQL (high level)

**Registry / layouts**

- `health`, `languages`, `translations`, `translate`
- `entities`, `entity`, `entitySchema`, `registrySnapshot`
- layout settings read/upsert/delete

**Records / audit**

- `record` / `records` / create / update / softDelete / delete / restore
- `recordActivities` / `recordRevisions`
- `aggregateRecords`

**App metadata**

- `me`, `users`, `roles`
- `presets`, `dashboards`, `panels`
- `file` / `files`
- user settings + recent record views
- schema drift / sync (`runSchemaSync`: crm_schema ADD COLUMN, backfill, indexes, FKs, unique groups; dry-run default)
- scheduled tasks (`scheduledTasks`, `runScheduledTask`, `generateScheduleSlots`); in-process cron via `TASK_SCHEDULER_ENABLED` (default on)

## Cutover

Keep `DIRECTUS_RUNTIME=off` (checked by `npm run registry:check-cutover`). That flag refuses the retired Directus HTTP SDK. Production rows can still use `backend_target=DIRECTUS` through the GraphQL adapter (`DIRECTUS_GRAPHQL_URL` + `DIRECTUS_TOKEN`). Do not set `VITE_DIRECTUS_TOKEN`.
