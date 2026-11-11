# CoreEngine — schema-driven business application platform

Vue 3 + Vite + TypeScript. Schema-driven objects, layouts, documents, dashboards, and reports via GraphQL BFF + Supabase registry — with domain packs for vertical starters (Sales, Clinic, Pricing, Documents).

**License:** MIT ([`LICENSE`](LICENSE))

**Project status:** early-stage. The idea is clear (git-versioned domain packs, role layouts, pricing/document features), but CoreEngine is **not yet** a drop-in NocoBase or Salesforce alternative for production adoption. Expect gaps in CI coverage, durable automation, SSO, and the server documents API (still a stub). Interactive DocEngine in the UI works today.

**CoreEngine takes the core Salesforce ideas** (custom objects, relationships, role-based layouts, record pages with related lists, and in-app document generation) **and delivers them as a modern, self-hosted, free platform** with git-versioned domain packs — without the per-seat cost or complexity of the full Salesforce stack.

Build internal and vertical applications with custom objects, relationships, role-specific forms, and in-app document generation — without starting from a blank low-code canvas.

**CoreEngine is for teams that want:**
- A real data model they control (custom objects + relationships)
- Different edit/view forms per role (Sales Rep vs Manager vs Pricing)
- Domain starters they can version in git (Sales + Pricing, Clinic, Documents)
- In-app document generation (DocEngine HTML/PDF in the browser) and price-list trees. The automation route `POST /api/v1/documents/generate` is a Phase 0 stub (HTTP 501) — it does not produce a file
- A GraphQL + REST API they can automate with n8n (records, query, flows). Document generate on that API is the same stub

**It is not trying to be:**
- A full enterprise Salesforce replacement (security, AppExchange, and automation depth still differ)
- A polished out-of-the-box CRM like Twenty
- A free-form internal-tools canvas like Retool
- A no-code workflow product with a visual multi-step designer (use n8n on top of CoreEngine)

### Quick comparison

| Need | CoreEngine | Twenty | Retool | Salesforce |
|------|------------|--------|--------|------------|
| Custom objects + relationships | Strong | Strong | Query existing data | Excellent |
| Role-specific layouts + list filters | Strong (UX); object CRUD enforced at BFF | Permissions-focused | Build separate UIs | Excellent |
| CRM pipeline + email/calendar | Starter pack | Strong | Build it | Excellent |
| Campaign → promo pricing engine | Built-in | Custom objects | Build it | Custom / AppExchange |
| Document generation (PDF/HTML) | UI DocEngine; server API is a stub (HTTP 501) | Limited | Build it | Good (packages) |
| Visual multi-step workflows | Via n8n | Built-in + AI agents | Built-in | Flow + Apex |
| Config as code (packs in git) | Yes | Emerging | App source | Metadata / DX |
| Price | Free / self-hosted | Free / paid cloud | Paid | Expensive |

---

## Capability overview

How CoreEngine maps to common platform checklist items today:

| Area | CoreEngine today |
|------|------------------|
| **Workflow engine** | Partial — flow **keys** + handlers (HTTP / update record), record-automation **conditions**, Setup → **Tasks** (scheduled jobs). Visual multi-step designer lives in **n8n** (or similar), not inside CoreEngine. |
| **Permissions** | Partial — **Object-level CRUD** (create/read/update/delete/import/export) is **enforced at the BFF**. **Per-role record list filters/views**, **per-role layouts**, and **conditional hide/readonly** are strong in the UX. **Field-level security is not enforced at the API**; per-role list filters are view configuration, not server-side row ACL. No sharing/owner security yet. Gaps vs NocoBase-class platforms are mainly **SSO/MFA** and **field-level API enforcement**. |
| **Authentication** | Partial — local email/password via BFF JWT (`/auth/login`, refresh). **No** SSO / OAuth / MFA / enterprise IdP yet. |
| **Version control** | Partial — schemas, layouts, roles, and templates ship as **domain packs** (JSON under `supabase/domains/`) with `platform:export-pack` / `apply-pack`; versioned in **git**. No in-app config revision UI. |
| **Application builder** | Yes — Object Manager, Form / Record Page / list / tree designers, **dashboards**, role-scoped **navigation** apps, reports. Pages are schema/nav targets (not a free-form CMS). |
| **Automation** | Partial — record automations (set fields, notify, break, **trigger flow**), outbound **webhooks** via flow keys, in-process **scheduled jobs** (`TASK_SCHEDULER_ENABLED`, default on). Failures are logged only. |
| **Reliable automation** | **Open (critical)** — no durable job queue, retry policies, dead-letter queue, execution history / monitoring, or idempotency keys. The scheduler is a timer inside each BFF process: due tasks are selected, then a non-transactional “already running” check. Nothing elects a leader, so two BFF instances can both fire the same job. For resilient multi-step runs, use **n8n** (or similar) against CoreEngine APIs, and run the scheduler on one process only. |
| **Validation & business rules** | Partial — field required / unique / unique groups exist. Record automations (conditions + notify / set fields / break) are commonly used for validation rules today. No dedicated validation-rules designer or field-level error blocking yet. |
| **Admin config audit** | **Open** — record **Activity & Revision Tracking** covers business data; no audit history yet for administrative configuration changes (entities, fields, layouts, roles, automations, etc.). |
| **Integrations** | Partial — GraphQL BFF + REST CRUD, SOQL-style `/api/v1/query`, n8n runbook, optional Hasura/Directus record backends. **`POST /api/v1/documents/generate` is a Phase 0 stub (HTTP 501)** — interactive DocEngine in the UI works; server generate for automations is not ready. No first-party SaaS connector catalog. |

---

## Features

### Schema-driven UI
- Object Manager, role-scoped Block Layouts, list/tree/table designers, and Form Builder canvas.
- **Per-role edit and view forms** — different layouts for each user group on the same object.
- **Per-role list filters (views)** — each role can have its own saved filters / list views for an object’s record list.
- **Tree navigation + master-detail** — hierarchical group trees (e.g. Item Groups) with filtered lists and related-detail panels (Item → Item Prices) without custom code.
- **Batch insert** — multi-select related records (e.g. Opportunity Items) from a hierarchical catalog with automatic price resolution and running totals.
- **In-context edit dialogs** — open create/edit forms in a modal on the same list or detail page without full navigation.
- **Custom palette blocks** (Attachments, DocEngine, Tree table picker, Scheduler) can be placed more than once on a Block Layout — they stay available after drop.
- Block Layout **show / readonly conditions** on fields and groups (visibility and editability driven by record values).
- **Inline editor** in object / related lists for editing cells without opening the record.
- **Child value lookup** on fields — resolve a value from a related / child collection (with optional parent-field filters), e.g. Item Price → Price by Item and Account price group.
- **Soft delete** for entities — records are marked deleted (and filtered from default lists) instead of permanently removed, with restore where supported.

### Application builder
- **Dashboards** — Setup designer + runtime metric/chart/label panels.
- **Navigation apps** — role-scoped folders, entity lists, dashboards, reports, and home routes.
- **Record / form / list / tree** pages driven by `layout_settings` (no hard-coded detail forms).

### Automation & workflows
- **Record automations** on create/update/delete: conditions (AND/OR, require-changed), set fields, notify, break, trigger a flow key.
- **Setup → Flows** — named `app_flow_triggers` (`http` webhook to n8n/external URL, or `update_record`). Prefer keys over raw URLs in automations.
- **Setup → Tasks** — scheduled background jobs (e.g. Sync promo prices, notifications via flow triggers). The runner lives in the BFF process and is on unless `TASK_SCHEDULER_ENABLED=false`. A second BFF instance will tick the same table and can run the same job again.
- Complex branching / retries / multi-system orchestration: use **n8n** against CoreEngine REST/GraphQL ([`docs/n8n-bff-flows.md`](docs/n8n-bff-flows.md)).

### Permissions & authentication
- **Object-level CRUD** (+ import/export) matrix per role — **enforced by the BFF** on GraphQL/REST record operations; admins bypass; role preview in the UI.
- **Per-role layouts** and **per-role list filters/views** (each role’s own record-list filters). Conditional field/group **hide / readonly** is UI/layout behavior, not field-level API security.
- **Auth:** BFF local login (`VITE_AUTH_MODE=bff`) issuing Bearer access + refresh tokens. Automation users: `npm run registry:seed-n8n-automation-user`. No SSO / MFA yet.

### Documents & list reports
- Setup → Document Templates with Field Mapping against live or sample `$payload`.
- **List Document report** actions build one DocEngine document from filtered / visible list rows (`$payload.records`, `$payload.meta.filter`).
- **Tree-aware price lists** — generate grouped Price List documents (by Item Group hierarchy) for a selected Price Group directly from the Item Price list.
- HTML and PDF preview expand **array-sourced sections** so each mapped group instance renders (not only the first).
- **In the app, DocEngine works** (fill a template, HTML preview, PDF download). That path stays in the browser.
- **Automation generate is a stub.** `POST /api/v1/documents/generate` and GraphQL `generateDocument` validate the body, then return **HTTP 501** (`DOCUMENTS_GENERATE_STUB`). That route does not write a PDF or HTML file. Contract: [`docs/generate-document-api.md`](docs/generate-document-api.md).
- **Cross-object files (D2D)** — attach and link the same files across different objects and related records.

### Reports
- Pivot / report views with a **drill-down** option to open the source records behind a summarized cell.

### Import / export
- Import and export support for moving records in and out of schema-driven objects.

### Activity & Revision Tracking
- Per-entity accountability (activity only, or activity + revisions) for audit history on create/update/delete.

### Tree price lists (Item Price / Item group)
- Virtual payload for Tree mode Field Mapping:
  - `$payload.item_group_tree_rows` — group shells in DFS order
  - `$payload.item_group_tree_rows.children` / `$children` — nested price rows per group
  - also `item_group_tree` and `item_group_tree_sections` for alternate mapping shapes
- Selecting an **Item group** in Tree mode includes that group **and all nested child groups** in the related list and Document report.
- Within each group, Item order follows Tree settings **`main.sort`** (Display Template for M2O Item).
- Price cells in reports use the field’s **Currency / Number** interface (e.g. `68.88 USD`), matching the object list.

### Platform kernel & packs
- New customer DB = new Postgres; kernel in `supabase/migrations/`, vertical packs in `supabase/domains/` (Sales, Clinic, Pricing, Documents).
- Pack JSON (entities, roles, layouts, optional records) is the portable baseline — export from a live DB with `npm run platform:export-pack`, version in git, apply with provision / `platform:apply-pack`.
- **CoreEngine Sales** (`sales` + `pricing`) is the commercial CRM/catalog starter; see [`supabase/README.md`](supabase/README.md) and [`supabase/domains/sales/README.md`](supabase/domains/sales/README.md).

### Data layer
- **Registry (schema, layouts, roles, packs)** — Supabase (`crm_schema`) exposed via GraphQL BFF + HTTP API.
- **Live records** — pluggable backends selected per entity (`backend_target`):
  - Supabase
  - PLATFORM (native)
  - Hasura
  - Directus  
  All accessed through a unified GraphQL interface.

### Integrations (BFF REST / GraphQL)
- Bearer JWT records API: `/api/v1/:collection` CRUD (PK or `uniqueField:value`) and SOQL-style `GET|POST /api/v1/query`.
- `POST /api/v1/documents/generate` — **stub** (HTTP 501, `code: DOCUMENTS_GENERATE_STUB`) until server DocEngine generate ships.
- **Record + children in one call:** `GET /api/v1/:collection/:id?expand=children` returns the parent plus `_children` (every entity with an M2O FK to that record, e.g. Opportunity → `quote`) and `_files` (attachments). Optional `childLimit`, `expand=children,nofiles`.
- GraphQL at `/graphql` for the Vue app and advanced clients.
- n8n: webhook ← CoreEngine flow key; login + REST/GraphQL write-back. Runbook: [`docs/n8n-bff-flows.md`](docs/n8n-bff-flows.md).

---

## Setup

### Quick start (Docker)

Minimal stack: Postgres + BFF. Optional web UI needs a sibling `docEngine` checkout next to this repo (local `file:` dependency).

```bash
cp .env.docker.example .env
cp .env.docker.example supabase/.env

docker compose up -d db
docker compose run --rm --workdir /app bff \
  npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env \
  ./scripts/provision-platform-db.mts --domain sales
docker compose up -d bff
# Optional UI (requires ../docEngine):
# docker compose --profile ui up -d --build web
```

- BFF health: http://localhost:4000/health  
- UI (if started): http://localhost:8080  
- Login after provision: `admin@example.com` / `admin12345`

File uploads / Storage are not fully wired in this minimal compose (needs Supabase Storage + `SERVICE_ROLE_KEY`). Optional Hasura remains under [`docs/hasura/docker-compose.yaml`](docs/hasura/docker-compose.yaml).

### Local (npm)

Install with **npm**. Lockfiles for that path: `package-lock.json` at the repo root and in `crm-bff/`. `pnpm-lock.yaml` is also in the tree and is not what these scripts use.

```bash
cp .env.example .env
cp supabase/.env.example supabase/.env
# Point supabase/.env at a new empty Postgres DB; fill VITE_* in .env

npm install
npm run bff:install

# Cross-platform (Node):
npm run platform:provision:node -- --domain none   # kernel + documents pack
# or: npm run platform:provision:node -- --domain sales
# or: npm run platform:provision:node -- --domain clinic --admin-password 'ChangeMeNow!'

npm run bff:dev   # terminal 1 — GraphQL BFF on :4000
npm run dev       # terminal 2 — Vite (requires sibling ../docEngine)
```

On Windows, `npm run platform:provision` is the PowerShell wrapper (`-Domain` / `-AdminPassword`).

Default admin after provision: `admin@example.com` / `admin12345`.

See [`supabase/README.md`](supabase/README.md) for the platform kernel + domain packs (Sales / Clinic).

### Tests / CI

```bash
npm test                      # Vitest app unit smoke tests
npm --prefix crm-bff test
npm --prefix crm-bff run typecheck
```

GitHub Actions (`.github/workflows/ci.yml`) runs BFF typecheck + tests and app unit tests on `main`. Full Vue `npm run build` is not gated yet (needs sibling DocEngine). Coverage is still minimal.

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
| `SMTP_HOST` / `SMTP_FROM` | Optional BFF platform mail (invite, reset). Record and document email stays in n8n |
| `TASK_SCHEDULER_ENABLED` | In-process scheduled jobs inside this BFF. Default **on** (`false` / `0` / `off` disables). Set `false` on every extra instance; there is no lock that stops two processes from running the same job |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run bff:dev` | GraphQL BFF |
| `npm run build` | Type-check and production build |
| `npm run preview` | Preview production build |
| `npm run registry:check-cutover` | Migration health gate |
| `npm run registry:migrate` | Apply platform kernel SQL (PowerShell + `psql`) |
| `npm run registry:migrate:node` | Same kernel SQL via Node (`pg`); use this on Linux |
| `npm run platform:provision` | New customer DB via PowerShell (`-Domain`, `-AdminPassword`) |
| `npm run platform:provision:node` | Same provision via Node (`--domain`, `--admin-password`) |
| `npm run platform:apply-pack` | Apply a domain pack onto an existing kernel DB |
| `npm run platform:export-pack` | Save live Setup config back into `supabase/domains/<id>` |

## Layout types

Entity layout schemas live under `src/interfaces` / config layout services and are stored in registry `layout_settings` (served by the BFF).
