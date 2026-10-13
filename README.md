# Helix — multi-purpose platform

Vue 3 + Vite + TypeScript + OpenVue. Schema-driven objects, layouts, documents, projects, and reports via GraphQL BFF + Supabase registry.

## Setup

```bash
cp .env.example .env
# Fill VITE_SUPABASE_ANON_KEY (and any local Postgres/BFF secrets in supabase/.env)

npm install
npm run bff:dev   # terminal 1 — GraphQL BFF on :4000
npm run dev       # terminal 2 — Vite
```

See `supabase/MIGRATION.md` for cutover history and the health gate.

### Environment (live)

| Variable | Description |
|----------|-------------|
| `VITE_DATA_SOURCE` | `graphql` (required for live bridges) |
| `VITE_RECORDS_SOURCE` | Usually `graphql` (inherits data source if unset) |
| `VITE_GRAPHQL_URL` | BFF GraphQL endpoint (default `http://localhost:4000/graphql`) |
| `HASURA_GRAPHQL_URL` | Hasura GraphQL for `backend_target=HASURA` entities (default `http://localhost:8090/v1/graphql`) |
| `HASURA_ADMIN_SECRET` | Hasura admin secret used by the BFF adapter |
| `DIRECTUS_GRAPHQL_URL` | Directus GraphQL for `backend_target=DIRECTUS` entities (default `http://localhost:8055/graphql`) |
| `DIRECTUS_TOKEN` | Directus static token used by the BFF adapter (not `VITE_DIRECTUS_TOKEN`) |
| `VITE_AUTH_MODE` | `bff` — login via BFF `/auth/login` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase / PostgREST (optional registry REST) |
| `DIRECTUS_RUNTIME` | Must be `off` (legacy HTTP SDK refuse; GraphQL adapter is separate) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run bff:dev` | GraphQL BFF |
| `npm run build` | Type-check and production build |
| `npm run preview` | Preview production build |
| `npm run registry:check-cutover` | Migration health gate |
| `npm run registry:migrate` | Apply registry SQL migrations |

## Layout types

Entity layout schemas live under `src/interfaces` / config layout services and are stored in registry `layout_settings` (served by the BFF).
