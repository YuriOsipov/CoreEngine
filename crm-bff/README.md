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
- REST records (Bearer JWT; n8n-friendly):
  - `GET|POST /api/v1/query` — SOQL subset (`q=SELECT … FROM …`; `*`, `*, relation.path`, WHERE/ORDER/LIMIT)
  - `GET /api/v1/:collection` — list (`?filter={...}&fields=&sort=&limit=&offset=&search=`; `includeDeleted=true` needs **export**; limit > 500 or unlimited needs **export**, hard cap 10_000)
  - `GET /api/v1/:collection/:id` — read one (PK or `uniqueField:value`; `?expand=children` → `_children` reverse-M2O + `_files`)
  - `POST /api/v1/:collection` — create; `?upsert=true` (+ optional `&by=<uniqueField>`) for upsert (requires **create and update**; auth validated before existence lookup)
  - `PUT|PATCH /api/v1/:collection/:id` — update (PK or `uniqueField:value`)
  - `DELETE /api/v1/:collection/:id` — soft-delete; `?hard=true` hard-delete
- REST documents: `POST /api/v1/documents/generate` — **Phase 0 stub** (HTTP 501, `code: DOCUMENTS_GENERATE_STUB`); contract only — see docs/generate-document-api.md. Interactive DocEngine in the Vue UI works; server generate for n8n is not implemented yet.
- Sales pack examples: [supabase/domains/sales/README.md](../supabase/domains/sales/README.md)
- Files: `POST /files`, `PATCH /files/:id`, `GET /assets/:id` → Supabase Storage + `public.files`
- Flows: `POST /flows/trigger/:key` → local `app_flow_triggers` (`http` | `update_record`; Setup → Flows)
  - Auth: JWT Bearer or `FLOWS_TRIGGER_SERVICE_KEY` (default required)
  - Outbound `http` handlers inject `X-CRM-Flow-Secret` / `X-CRM-Source` from `N8N_WEBHOOK_*`
  - Runbook: [docs/n8n-bff-flows.md](../docs/n8n-bff-flows.md)
- Platform mail: in-process SMTP (`sendPlatformMail`) for product mail only — invite, password reset, login code. Set `SMTP_HOST` and `SMTP_FROM` (optional `SMTP_PORT` default 587, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`). Unset host leaves mail off. Record, document, and automation email stays in n8n. No public send route.

Loads DB settings from `../supabase/.env` and `../.env`.

Hasura (optional records backend): `HASURA_GRAPHQL_URL` (default `http://localhost:8090/v1/graphql`) + `HASURA_ADMIN_SECRET`. Local Postgres (no Docker DB): create database `hasura` on `localhost:5434`, then `docker compose -f docs/hasura/docker-compose.yaml up -d`. Flip an entity with `npm run registry:set-entity-backend -- <api_name> HASURA`. Vue still uses `VITE_GRAPHQL_URL` (this BFF).

Directus (optional records backend, GraphQL only): `DIRECTUS_GRAPHQL_URL` (default `http://localhost:8055/graphql`) + `DIRECTUS_TOKEN`. Keep `DIRECTUS_RUNTIME=off` and do not set `VITE_DIRECTUS_TOKEN`. Flip an entity with `npm run registry:set-entity-backend -- <api_name> DIRECTUS`. Override collection / PK via `backend_config.directus` (`collection`, `idField` default `id`, `statusField` default `status`, optional `endpoint`).

## GraphQL (high level)

**Auth (Setup / registry / reads)**

- Setup and registry **mutations** (create/update/delete entity or field, layout upsert/delete, unique groups, automations, schema sync/drift, dashboards/panels, org settings) require an **admin** Bearer JWT (`adminAccess` / role admin). Unauthenticated or non-admin callers get `Admin access required`.
- Auth: `fetchMe` accepts only **signature-verified** access JWTs (`token_use=access`, HS256). Refresh tokens are **opaque** DB rows (hashed), revoked on logout, refresh rotation, and password change — they cannot pass `verifyAccessToken`. `adminAccess` / role flags come from active `app_users` only (never JWT claims). Example/placeholder `AUTH_JWT_SECRET` values are refused at startup; provision runs `ensure-auth-jwt-secret`. No Directus env-token identity fallback.
- Record CRUD uses object-level `assertEntityPermission`. Audit stamps use the verified `me` from that check. Nested relation / child expands receive that `me` and re-check read per related entity.
- Matrix-excluded / PLATFORM collections (docs, Setting, user_setting, …): **admin-only** on the records API.
- Hard delete (`deleteRecord` / REST `?hard=true`): **admin-only**; soft delete still uses object `delete`.
- File GraphQL/`/assets` reads require auth and parent-entity read (or uploader/admin for orphans).
- Login/refresh and public i18n/health GraphQL fields are rate-limited per client IP.
- List / SOQL: `includeDeleted` and limits above 500 (or unlimited) require **export**; hard cap 10_000 at the policy layer and backends.
- Resolver coverage: `resolverAccessPolicy.test.ts` fails CI if any Query/Mutation root is missing from the public / authenticated / admin / entity-permission allowlists.
- **Sensitive reads** also require auth: `recordActivities` / `recordRevisions` / `recordFiles` use the parent entity’s **read** permission (revisions must not bypass object ACL). `file` / `files`, `users`, `roles` require a logged-in user. Registry/layout reads (`entities`, `entity`, `entitySchema`, `registrySnapshot`, `layoutSettings`) require authentication (any logged-in user; app runtime needs them).

**Registry / layouts**

- `health`, `languages`, `translations`, `translate`
- `entities`, `entity`, `entitySchema`, `registrySnapshot`
- layout settings read; upsert/delete are admin-only (see above)

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
- scheduled tasks (`scheduledTasks`, `runScheduledTask`, `generateScheduleSlots`); in-process cron via `TASK_SCHEDULER_ENABLED` (default on). Each BFF process ticks on its own. Due rows are selected, then a non-transactional “already running” check — no leader lock — so two instances can both run the same job. Leave the scheduler on for one process and set `TASK_SCHEDULER_ENABLED=false` on the others.

## Cutover

Keep `DIRECTUS_RUNTIME=off` (checked by `npm run registry:check-cutover`). That flag refuses the retired Directus HTTP SDK. Production rows can still use `backend_target=DIRECTUS` through the GraphQL adapter (`DIRECTUS_GRAPHQL_URL` + `DIRECTUS_TOKEN`). Do not set `VITE_DIRECTUS_TOKEN`.
