# Setup and development

Quick try-out is in the root [`README.md`](../README.md). This page covers full Docker, local npm, environment variables, scripts, and CI.

**Support:** community best-effort, no SLA — [`SUPPORT.md`](../SUPPORT.md).  
**Upgrades:** [`upgrading.md`](./upgrading.md). **Backups:** [`backup-restore.md`](./backup-restore.md).  
**Security:** [`security.md`](./security.md). **OIDC:** [`oidc-sso.md`](./oidc-sso.md).

## Quick start — lightweight (recommended try-out)

Postgres + BFF only ([`docker-compose.minimal.yml`](../docker-compose.minimal.yml)). No Storage / Studio / PostgREST. Needs Docker:

```bash
# Windows (PowerShell):
npm run install:minimal
# or: powershell -File ./scripts/install-minimal.ps1 -Domain sales -WithUi

# macOS / Linux:
chmod +x ./scripts/install-minimal.sh
./scripts/install-minimal.sh --domain sales --with-ui
```

**What `--domain sales` ships:** kernel + Documents pack (template objects; no sample templates) + Sales pack (CRM + catalog/pricing entities, roles, layouts) with demo records — accounts/contacts, opportunities + line items, item groups/items/price lists/item prices, a campaign + promotions, and a few messages. Kernel-only: `--domain none`. Other packs: `clinic`, `pricing`, `documents`.

- BFF health: http://localhost:4000/health  
- UI (if started): http://localhost:8080  
- Login: `admin@example.com` with the password printed by provision (or pass `--admin-password` / `-AdminPassword`)

Optional `--with-ui` builds the web profile. Interactive DocEngine uses npm `@docengine/*` (or `npm run docengine:use-local` with sibling [`../docEngine`](https://github.com/YuriiOsypov/docEngine) while developing the editor).

## Quick start — all-in-one Docker (full Supabase)

Self-hosted Supabase + CoreEngine BFF + optional web UI. Expect **several GB of RAM**.

```bash
cp .env.docker.example .env
cp docker/supabase/.env.example docker/supabase/.env
# Set the SAME unique POSTGRES_PASSWORD and POSTGRES_APP_PASSWORD in both files.
# Copy ANON_KEY + SERVICE_ROLE_KEY from docker/supabase/.env into .env (BFF Storage).

docker compose up -d
docker compose run --rm --workdir /app bff \
  npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env \
  ./scripts/ensure-app-db-role.mts --as-superuser
docker compose run --rm --workdir /app bff \
  npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env \
  ./scripts/provision-platform-db.mts --domain sales
docker compose up -d bff
# Optional UI: docker compose --profile ui up -d --build web
```

- BFF: http://localhost:4000/health — UI: http://localhost:8080 — Supabase Envoy: http://localhost:8000  
- Leave `AUTH_JWT_SECRET` empty; provision generates it. Example/placeholder JWT secrets and known weak bootstrap passwords are refused at every BFF start (unless `ALLOW_INSECURE_BOOTSTRAP=true`).

**External host Supabase:** [`docker-compose.supabase.yml`](../docker-compose.supabase.yml).  
Optional Hasura: [`hasura/docker-compose.yaml`](./hasura/docker-compose.yaml).  
Optional Keycloak: [`docker-compose.keycloak.yml`](../docker-compose.keycloak.yml) — see [`oidc-sso.md`](./oidc-sso.md).  
Vendored Supabase pin: [`docker/supabase/VENDOR.md`](../docker/supabase/VENDOR.md).

## Local (npm)

```bash
cp .env.example .env
cp supabase/.env.example supabase/.env
# Point supabase/.env at a new empty Postgres DB; fill VITE_* in .env

npm install
npm run bff:install
npm run platform:provision -- --domain sales --admin-password 'ChooseAUniqueSecret!'
npm run bff:dev   # terminal 1 — :4000
npm run dev       # terminal 2 — Vite (@docengine/* from npm, or docengine:use-local)
```

Admin after provision: `admin@example.com` (password change required on first login).  
Kernel + packs: [`supabase/README.md`](../supabase/README.md).

## OIDC SSO (Keycloak)

```bash
docker compose -f docker-compose.keycloak.yml --profile oidc up -d
```

Enable `OIDC_*` in repo-root `.env` and restart the BFF. Full env, linking, JIT, and deprovisioning: [`oidc-sso.md`](./oidc-sso.md).

## Environment (live)

| Variable | Description |
|----------|-------------|
| `VITE_DATA_SOURCE` | `graphql` (required for live bridges) |
| `VITE_RECORDS_SOURCE` | Usually `graphql` (inherits data source if unset) |
| `VITE_GRAPHQL_URL` | BFF GraphQL endpoint (default `http://localhost:4000/graphql`) |
| `HASURA_GRAPHQL_URL` / `HASURA_ADMIN_SECRET` | Hasura for `backend_target=HASURA` |
| `DIRECTUS_GRAPHQL_URL` / `DIRECTUS_TOKEN` | Directus for `backend_target=DIRECTUS` |
| `VITE_AUTH_MODE` | `bff` — login via BFF `/auth/login` |
| `OIDC_*` | Optional SSO — [`oidc-sso.md`](./oidc-sso.md) |
| `TRUST_PROXY` | Behind TLS-terminating proxy so `request.protocol` is `https` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Optional registry REST |
| `DIRECTUS_RUNTIME` | Must be `off` |
| `SMTP_HOST` / `SMTP_FROM` | Optional BFF platform mail (invite, reset, failed-run alerts) |
| `N8N_BASE_URL` / `N8N_WEBHOOK_SECRET` / `N8N_ENCRYPTION_KEY` | Your n8n instance for Setup → Connections |
| `ACTIVEPIECES_BASE_URL` / `ACTIVEPIECES_WEBHOOK_SECRET` | Optional MIT Activepieces (`target=activepieces` + flow id) |
| `AP_EMAIL` / `AP_PASSWORD` | Activepieces admin for `registry:seed-activepieces-flows` (CE JWT; not Platform API keys) |
| `ACTIVEPIECES_SEED_URL` / `AP_FRONTEND_URL` | Host URL the seed script reaches (default `http://127.0.0.1:8081`) |
| `AP_ENCRYPTION_KEY` / `AP_JWT_SECRET` / `AP_POSTGRES_PASSWORD` | Required to start Activepieces with the minimal Compose stack |
| `FLOWS_HTTP_ALLOWED_HOSTS` | Hosts allowed for private/Docker HTTP flow targets |
| `CRM_N8N_EMAIL` / `CRM_N8N_PASSWORD` | Integration user for n8n → BFF |
| `FAILED_RUN_NOTIFY` / `FAILED_RUN_NOTIFY_EMAIL` | Optional email on flow/task failure |
| `TASK_SCHEDULER_ENABLED` | In-process scheduled jobs (default on). Keep **on for one** BFF; set `false` on replicas. Jobs take a Postgres advisory lock; Message dispatch claims rows with `SKIP LOCKED`. |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run bff:dev` | GraphQL BFF |
| `npm run build` | `vue-tsc -b && vite build` — CI app build job |
| `npm run build:ci` | `vite build` only (local bundle without typecheck) |
| `npm run preview` | Preview production build |
| `npm run install:minimal` | One-shot lightweight Docker install (Windows PowerShell) |
| `npm run install:minimal:sh` | Same via bash |
| `npm run registry:migrate` | Apply platform kernel SQL (PowerShell + `psql`) |
| `npm run registry:migrate:node` | Same via Node (`pg`) — Linux / Docker |
| `npm run registry:smoke-upgrade` | Migrate twice + `/health` |
| `npm run registry:smoke-backup-restore` | `pg_dump` archive check |
| `npm run registry:seed-n8n-pack-flows` | Seed pack flow keys + Message outbox (`--pack=sales`) |
| `npm run registry:seed-n8n-automation-user` | Create Integration user for n8n / Activepieces BFF login |
| `npm run registry:seed-activepieces-flows` | Import AP templates, project vars, Connections `flowId` (CE JWT; `--only=sync_promo_prices`) |
| `npm run platform:provision` | **New** customer DB (`--domain`, `--admin-password`) |
| `npm run platform:apply-pack` | Apply a domain pack onto an existing kernel DB |
| `npm run platform:export-pack` | Save live Setup config into `supabase/domains/<id>` |

## Tests / CI

```bash
npm test                      # Vitest app unit smoke tests
npm --prefix crm-bff test     # guard audit + field-security / owner RLS
npm --prefix crm-bff run typecheck
npm run build                 # vue-tsc -b && vite build
```

GitHub Actions ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)): BFF typecheck + tests, app unit tests, and app build (`npm run build`: `vue-tsc -b && vite build`). Default installs use **`npm ci`** against lockfile `@docengine/*@0.0.105`. Stubs (`ci/stubs/`) are opt-in only via `workflow_dispatch` → Use DocEngine stubs (`DOCENGINE_ALLOW_STUBS=true`); registry miss / network errors fail the job. Real PDF/HTML smoke belongs in the DocEngine package CI (or locally: `crm-bff` `npm run test:docengine-render`). Maintainers: `npm run docengine:use-local` / `docengine:use-npm` / `docengine:use-stub`.

Layout schemas live under `src/interfaces` / config layout services and are stored in registry `layout_settings`.
