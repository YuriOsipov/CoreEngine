# CoreEngine — schema-driven business application platform

Vue 3 + Vite + TypeScript. Schema-driven objects, layouts, documents, dashboards, and reports via GraphQL BFF + Supabase registry — with domain packs for vertical starters (Sales, Clinic, Pricing, Documents).

**License:** MIT ([`LICENSE`](LICENSE)). Report vulnerabilities via [`SECURITY.md`](SECURITY.md).

**DocEngine (UI documents):** interactive HTML/PDF editing ships as a **sibling repo**, not this tree. It is **public** on GitHub ([YuriiOsypov/docEngine](https://github.com/YuriiOsypov/docEngine)) under the **MIT License** (same author). Local installs use `file:../docEngine`; CI swaps those deps for in-repo stubs. The MIT / self-hosted “free” pitch for CoreEngine’s document UI depends on that public MIT sibling — clone it next to this repo for `npm run dev` / the optional Docker `ui` profile. Server `generateDocument` in CoreEngine remains a Phase 0 stub (HTTP 501).

**Project status:** early-stage. Aimed at **SMB and mid-market** teams (not full Salesforce Enterprise sharing). The idea is clear (git-versioned domain packs, role layouts, pricing/document features), but CoreEngine is **not yet** a drop-in NocoBase or Salesforce alternative for production adoption. Expect gaps in durable automation, **manual share / groups / hierarchy** (owner row security + role View/Modify all cover the common “my rows / manager sees all” pattern), and the server documents API (still a stub). Optional OIDC SSO is available via an external IdP. Interactive DocEngine in the UI works today when the sibling is present.

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

| Need | CoreEngine | NocoBase | Twenty | Retool | Salesforce |
|------|------------|----------|--------|--------|------------|
| Custom objects + relationships | Strong | Excellent | Strong | Query existing data | Excellent |
| Role layouts, list filters, object CRUD, field-level tiers | Strong (UX + BFF); **owner RLS** + role **View/Modify all**; no manual share yet | Strong (field + record/sharing rules) | Permissions-focused | Build separate UIs | Excellent |
| CRM pipeline + email/calendar | Starter pack | Build / plugins | Strong | Build it | Excellent |
| Campaign → promo pricing engine | Built-in | Build it | Custom objects | Build it | Custom / AppExchange |
| Document generation (PDF/HTML) | UI DocEngine (public MIT sibling); server API stub (501) | Plugins / build | Limited | Build it | Good (packages) |
| Visual multi-step workflows | Via n8n | Built-in (approvals, jobs) | Built-in + AI agents | Built-in | Flow + Apex |
| Config as code (packs in git) | Yes | Partial / app source | Emerging | App source | Metadata / DX |
| Price | Free / self-hosted (MIT) | Free Core (OSS) / commercial options | Free / paid cloud | Paid | Expensive |

---

## Capability overview

How CoreEngine maps to common platform checklist items today:

| Area | CoreEngine today |
|------|------------------|
| **Workflow engine** | Partial — flow **keys** + handlers (HTTP / update record), record-automation **conditions**, Setup → **Tasks** (scheduled jobs). Visual multi-step designer lives in **n8n** (or similar), not inside CoreEngine. |
| **Permissions** | Partial — **Object-level CRUD** + **field-level sensitivity tiers** + opt-in **owner row security** with role **View all / Modify all** at the BFF. **Not** manual share / groups / hierarchy. Aimed at SMB / mid-market; richer sharing later if demos need handoffs. |
| **Authentication** | Partial — local email/password via BFF JWT (`/auth/login`, refresh). Optional **OIDC SSO** via external IdP (Keycloak / Auth0 / …); MFA is configured on the IdP. See [`docs/oidc-sso.md`](docs/oidc-sso.md). |
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
- **Object-level CRUD** (+ import/export) matrix per role — **enforced by the BFF** on GraphQL/REST record operations; admins bypass; role preview in the UI. Setup → Roles also grants optional **View all** / **Modify all** per object (see owner row security below).
- **Field-level security (sensitivity flags)** — mark a field Restricted or Confidential in Setup → Fields; grant a per-role max read/edit tier in Setup → Roles. Platform default is open (new fields = None) until an admin marks them; a role with no grant sees none of the marked ones. Admins bypass. UI hide alone is not enough — the BFF enforces.
  - **Entity / pack default:** Setup → Entity parameters → **Default field security level** (`backend_config.defaultFieldSensitivity`, also settable in domain-pack entity JSON). New fields inherit that tier when create omits an explicit sensitivity; existing fields are unchanged.
  - **Covered (unit-tested gates / redaction):** record reads & writes; filters, sorts, aggregates — FLS `assertReadableQuery` runs in the facade **before** every store (Supabase, Hasura, Directus). Dotted SOQL keys like `manager.salary` are hop-checked then expanded to nested filters for Hasura/Directus (same shape Supabase EXISTS already used). List search: Supabase/Hasura exclude parent unreadable fields **and** M2O “Use in search” hops (related entity read ACL + template/fallback label sensitivity); Directus omits global search when any parent field is unreadable. Also: revision snapshot redaction; export/import pickers; upsert / unique-key lookups; `expand=children`; bulk update-by-filter / related; unique-violation API text (no Postgres `detail`); formula/rollup inherit max source sensitivity (+ Setup clamp); facade `access` required (`{ me }` / `SYSTEM_RECORD_ACCESS`); production boot refuses missing sensitivity columns; hard delete audits **before** erase (`hardDeleteAfterAudit`); refresh-token reuse revokes all sessions (migration `202611120001_refresh_token_reuse.sql`).
  - **Open / limited:** interactive DocEngine / `doc_value` follow document-object ACL (admin-only matrix today), not source-field sensitivity; server `generateDocument` is still a 501 stub; **ddlSync** only shapes physical columns — it does not read or enforce sensitivity (FLS stays in BFF + registry); record automations `setFields` / `notify` are trusted server rules; child value lookups have no dedicated FLS test; seeded **n8n automation user is an admin**; rollup **filters** on sensitive child fields and non-`{{…}}` formula idioms are not fully modeled; COUNT(`*`) rollups have no value-field tier; field-tier cache is **30s per process** (`FIELD_SECURITY_CACHE_TTL_MS`) — Setup clears the local instance immediately, other replicas can lag until TTL; create/update/soft-delete audit failures are still warn-only (hard delete is fail-closed).
- **Field sensitivity is column-level.** Flags mean “this column is sensitive for most roles on every record of the object.” They do **not** by themselves cover “Sales can see salary only for their own team.”
- **Owner row security** — opt-in per object so users without View/Modify all only reach rows they created. Default is **off**. Fits SMB / mid “private to creator + manager sees all” without Salesforce sharing rules.
  - **Enable object:** Setup → Entity parameters → **Owner row security**, or `backend_config.rowLevelSecurity = "owner"` in entity / pack JSON (`null` / omit = off). Needs **Created By** (`user_created`) — stamped on create; clients cannot set it.
  - **Typical setup:** Reps = Read/Update on the object (owner filter applies). Managers = same CRUD **plus View all** (and **Modify all** if they may edit anyone’s rows). Platform admins always bypass. Apply kernel migration `202611130002_role_permissions_view_modify_all.sql` (`npm run registry:migrate`) before using the new role columns.
  - **Enforced (BFF facade):** list, get-by-id, update, soft-delete, restore, aggregates (GraphQL / REST / SOQL-style). Without View all → `user_created = me.id`. Unauthorized get/update/delete → `Permission denied`. Soft-delete cascades run as system after the parent ownership check.
  - **Bypass:** admins; `SYSTEM_RECORD_ACCESS`; role **View all** (read/list/aggregate, still needs Read); role **Modify all** (update/delete/restore, implies View all, still needs Update/Delete). **View as role** applies the previewed role’s owner / View-all rules.
  - **Not yet:** manual share, public groups, role hierarchy, criteria rules, transferable `owner_id`. Role **list filters/views** are UX-only — not an API substitute for owner security.
  - **Tests:** `crm-bff/src/services/rowLevelSecurity.test.ts` (includes View all / Modify all bypass cases).
- **Admin “View as role”** — sends `X-Role-Preview` so object ACL, field security, and owner row security follow the selected role **without creating a test user**. Setup admin mutations and GraphQL `me` keep real admin identity; audit stamps still record the admin as the actor.
- **Per-role layouts** and **per-role list filters/views** (each role’s own record-list filters). Conditional field/group **hide / readonly** on layouts is UI behavior on top of, not instead of, field-level API security.
- **Auth:** BFF local login (`VITE_AUTH_MODE=bff`) issuing verified Bearer access tokens (**15-minute** TTL) + refresh tokens. Optional **OIDC SSO** (`OIDC_ENABLED`) — Authorization Code + PKCE against an external IdP (Keycloak, Auth0, …); BFF verifies the ID token and issues the same CoreEngine session. **Roles and admin flags stay in CoreEngine** (Setup → Users / Roles) — IdP groups/roles are not synced. MFA / enterprise policies live on the IdP. Automation users: `npm run registry:seed-n8n-automation-user`. See **OIDC SSO (Keycloak)** below and [`docs/oidc-sso.md`](docs/oidc-sso.md).

### Documents & list reports
- Setup → Document Templates with Field Mapping against live or sample `$payload`.
- **List Document report** actions build one DocEngine document from filtered / visible list rows (`$payload.records`, `$payload.meta.filter`).
- **Tree-aware price lists** — generate grouped Price List documents (by Item Group hierarchy) for a selected Price Group directly from the Item Price list.
- HTML and PDF preview expand **array-sourced sections** so each mapped group instance renders (not only the first).
- **In the app, DocEngine works** (fill a template, HTML preview, PDF download) when the public MIT sibling [docEngine](https://github.com/YuriiOsypov/docEngine) is checked out next to this repo. That path stays in the browser.
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

**All-in-one** (default): self-hosted Supabase (Postgres, Envoy, Auth, PostgREST, Storage, Studio, …) + CoreEngine BFF + optional web UI. Expect several GB of RAM for the full Supabase suite.

```bash
cp .env.docker.example .env
cp docker/supabase/.env.example docker/supabase/.env
# Set the SAME unique POSTGRES_PASSWORD and POSTGRES_APP_PASSWORD in both files.
# Copy ANON_KEY + SERVICE_ROLE_KEY from docker/supabase/.env into .env (BFF Storage).

docker compose up -d
# Ensure least-privilege role (init script also creates it on fresh volumes).
docker compose run --rm --workdir /app bff \
  npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env \
  ./scripts/ensure-app-db-role.mts --as-superuser
# Provision writes a unique AUTH_JWT_SECRET into gitignored ./.env (+ supabase/.env)
# and sets the admin password (printed if you omit --admin-password).
docker compose run --rm --workdir /app bff \
  npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env \
  ./scripts/provision-platform-db.mts --domain sales
# Start BFF after provision so it loads the persisted secret from env_file.
docker compose up -d bff
# Optional UI (image uses DocEngine CI stubs; full editor needs sibling ../docEngine + npm run dev):
# docker compose --profile ui up -d --build web
```

- BFF health: http://localhost:4000/health  
- UI (if started): http://localhost:8080  
- Supabase API / Storage / Studio (Envoy): http://localhost:8000  
- Login after provision: `admin@example.com` with the password you passed (`--admin-password`) or the one-time generated password printed by provision
- `AUTH_JWT_SECRET` (CoreEngine) is separate from Supabase `JWT_SECRET`. Leave `AUTH_JWT_SECRET` empty in `.env`; provision generates it. Example/placeholder CoreEngine JWT secrets are refused at **every** BFF start (any `NODE_ENV`).

**Minimal** (Postgres + BFF only, no Storage): [`docker-compose.minimal.yml`](docker-compose.minimal.yml).  
**External host Supabase** (BFF in Docker, DB/Envoy on the host): [`docker-compose.supabase.yml`](docker-compose.supabase.yml) overlay on the minimal file.  
Optional Hasura: [`docs/hasura/docker-compose.yaml`](docs/hasura/docker-compose.yaml).  
Optional Keycloak (OIDC SSO): [`docker-compose.keycloak.yml`](docker-compose.keycloak.yml) (`--profile oidc`) — see below and [`docs/oidc-sso.md`](docs/oidc-sso.md).  
Vendored Supabase pin: [`docker/supabase/VENDOR.md`](docker/supabase/VENDOR.md).

### OIDC SSO (Keycloak)

CoreEngine does **not** run an OAuth authorization server. Use an external OIDC IdP; the BFF is the relying party. Local email/password login stays available.

**Start local Keycloak** (imports realm `coreengine` + client `coreengine`):

```bash
docker compose -f docker-compose.keycloak.yml --profile oidc up -d
```

- Admin console: http://localhost:8081 — `admin` / `admin`
- Dev IdP user (matches provision email): `admin@example.com` / `ChangeMeNow!`

**Enable in repo-root `.env`**, then restart the BFF:

```bash
OIDC_ENABLED=true
OIDC_ISSUER=http://localhost:8081/realms/coreengine
# Docker BFF → Keycloak service name (browser still uses OIDC_ISSUER):
OIDC_INTERNAL_ISSUER=http://keycloak:8080/realms/coreengine
OIDC_CLIENT_ID=coreengine
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=http://localhost:4000/auth/oidc/callback
OIDC_UI_ORIGIN=http://localhost:5173
OIDC_DISPLAY_NAME=Keycloak
```

Set `OIDC_CLIENT_SECRET` from Keycloak → Clients → `coreengine` → Credentials (leave empty in committed examples).

Login page shows **Sign in with Keycloak** when `GET http://localhost:4000/auth/oidc/status` returns `enabled: true`.

**New users (default — JIT off):**

1. Create the user in CoreEngine (**Setup → Users**) with email + **non-admin** role.
2. Create the same email in Keycloak (`coreengine` realm → Users → Add user; set password; Email verified On).
3. Sign in via **Sign in with Keycloak** — first login links by email (`email_verified` required). Admins must set `oidc_issuer`/`oidc_subject` instead of email-link.

Keycloak Groups / realm roles are **not** mapped to CoreEngine roles. Change ACL in Setup → Users / Roles. Optional JIT (`OIDC_JIT_PROVISION` + `OIDC_DEFAULT_ROLE_BACKEND_ID` + `OIDC_ALLOWED_EMAIL_DOMAINS`) can auto-create unknown emails into one default role — still no IdP group sync. Admin accounts are never email-linked; set `oidc_issuer`/`oidc_subject` explicitly. Full detail: [`docs/oidc-sso.md`](docs/oidc-sso.md).

### Local (npm)

Install with **npm** only. Committed lockfiles: `package-lock.json` (repo root) and `crm-bff/package-lock.json`.

```bash
cp .env.example .env
cp supabase/.env.example supabase/.env
# Point supabase/.env at a new empty Postgres DB; fill VITE_* in .env

npm install
npm run bff:install

# Cross-platform (Node — default):
npm run platform:provision -- --domain none --admin-password 'ChooseAUniqueSecret!'
# or: npm run platform:provision -- --domain sales
# (omit --admin-password to get a one-time generated password printed at the end)

npm run bff:dev   # terminal 1 — GraphQL BFF on :4000
npm run dev       # terminal 2 — Vite (requires sibling ../docEngine)
```

Optional Windows PowerShell wrapper: `npm run platform:provision:ps1 -- -Domain sales -AdminPassword '…'`.

Admin after provision: `admin@example.com` with the password you passed or the one-time generated value. First login **requires a password change**.

**Startup refuses (BFF):**
- **JWT secret** — example/placeholder / too-short `AUTH_JWT_SECRET` values are refused on **every** start (any `NODE_ENV`).
- **Bootstrap admin passwords** — known weak passwords on bootstrap emails (`admin12345`, `ChangeMeNow!`, …) are refused **only when `NODE_ENV=production`**. Local `npm run bff:dev` and the default Docker compose stack do **not** set `NODE_ENV=production`, so that check does not run there; set `NODE_ENV=production` (and a unique admin password) for production deploys.

See [`supabase/README.md`](supabase/README.md) for the platform kernel + domain packs (Sales / Clinic).

### Security model and deployment checklist

What the BFF enforces today, and what operators must still do in production:

| Topic | Behavior |
|-------|----------|
| **JWTs** | Access tokens are HMAC-signed, algorithm-pinned, and verified on each guarded request. Access TTL is **15 minutes** (`ACCESS_TTL_SEC`); refresh tokens rotate the session. Reuse of a rotated refresh token revokes **all** sessions for that user. Placeholder / too-short `AUTH_JWT_SECRET` values are refused at every BFF start. |
| **OIDC SSO** | Optional external IdP (`OIDC_*`). BFF is the relying party (not an authorization server). ID tokens are verified via JWKS; users link by `oidc_issuer`/`oidc_subject` or verified email. **Roles stay in CoreEngine** — IdP groups are not synced. MFA is an IdP setting. Local password login remains available. |
| **Admin status** | Taken from the **database** (`is_admin` / role flags via `fetchMe`), not trusted from JWT / IdP claims. Setup stays on the real admin identity even when `X-Role-Preview` is set. |
| **Setup mutations** | GraphQL Setup / registry mutations require **admin** (`requireAdminAccess`). Non-admins cannot change entities, fields, roles, layouts, or packs through those resolvers. |
| **Field tiers** | Field sensitivity `0` / `1` / `2` + per-role max read/edit — enforced on record GraphQL/REST/SOQL paths (see Permissions). UI hide alone is not enough. **Production refuses to start** if sensitivity columns are missing (no silent FLS-off). In-memory tier cache TTL is **30s** per BFF process — Setup clears the local cache immediately; other instances can lag up to that TTL after a privilege downgrade. |
| **Owner row security** | Opt-in per entity (`rowLevelSecurity: owner`). Default path: creator-only rows. Managers: Setup → Roles → **View all** / **Modify all** on that object (migration `202611130002_…`). Admins / system bypass. **No** manual share, groups, or hierarchy — list filters alone are not enough without the owner toggle. |
| **Hasura / Directus** | Optional record backends for the BFF only. Keep their admin consoles, GraphQL endpoints, and secrets **off public networks**; clients talk to CoreEngine BFF, not those engines directly. |
| **Scheduler** | In-process (`TASK_SCHEDULER_ENABLED`, default on). Run it on **one** BFF instance; disable on extras — there is no leader election. |
| **Flows** | `FLOWS_TRIGGER_REQUIRE_AUTH=false` is **refused in production**. HTTP service-key callers still respect flow `allowedFields` on payload patches (trusted in-process `system` invokers do not). |
| **CORS** | `credentials: true` with an explicit origin allowlist. `CORS_ORIGIN=*` is ignored (and **refused in production**) so browsers never get reflected arbitrary Origins. |
| **TLS & rate limiting** | Terminate **TLS** at the reverse proxy / load balancer in front of the BFF. Login uses per-IP and per-**IP+email** failure windows (email-only lockout would let an attacker freeze someone else’s account). Put additional edge rate limiting in front for internet-facing deploys. Set `NODE_ENV=production` so weak bootstrap admin passwords and missing FLS schema are refused. |

See also [`SECURITY.md`](SECURITY.md) for how to report vulnerabilities.

### Tests / CI

Unit tests live next to source (`*.test.ts` under `crm-bff/src/` and `tests/`). CI is [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

```bash
npm test                      # Vitest app unit smoke tests
npm --prefix crm-bff test     # includes guard audit + field-security / owner RLS / leak tests
npm --prefix crm-bff run typecheck
npm run build:ci              # vite build only (what CI runs for the app)
```

GitHub Actions runs three jobs on `main` (and `workflow_dispatch`): BFF typecheck + tests, app unit tests, and Vue `npm run build:ci` (`vite build` only — no `vue-tsc`). The BFF `npm test` job includes:

- **Guard audit** — `crm-bff/src/resolvers/resolverAccessPolicy.test.ts` classifies every GraphQL Query/Mutation root and asserts the matching access guard.
- **Field-leak / field-security tests** — `crm-bff/src/services/fieldSecurity.test.ts` (tier gates / redaction) plus related coverage such as `uniqueGroups.formatError.test.ts` (unique-violation responses must not echo Postgres `detail` values).
- **Owner row security** — `crm-bff/src/services/rowLevelSecurity.test.ts` (owner filter merge, assert helpers, View all / Modify all bypass).

CI swaps the sibling `file:../docEngine` dependency for in-repo stubs under `ci/stubs/` so the production bundle is gated without requiring a DocEngine checkout. Vite only aliases `@docengine/field-date` to the sibling when that path exists.

`npm run build` is `vue-tsc -b && vite build`. **It does not pass today** — the repo still has Vue/TS typecheck debt — so use `npm run build:ci` (or fix `vue-tsc -b` locally) until that debt is cleared.

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
| `OIDC_ENABLED` / `OIDC_ISSUER` / `OIDC_CLIENT_*` | Optional SSO — see **OIDC SSO (Keycloak)** above and [`docs/oidc-sso.md`](docs/oidc-sso.md) |
| `OIDC_INTERNAL_ISSUER` | Optional; Docker BFF discovery/JWKS via Keycloak service (`http://keycloak:8080/realms/…`) while token `iss` stays `OIDC_ISSUER` |
| `OIDC_JIT_PROVISION` / `OIDC_DEFAULT_ROLE_BACKEND_ID` / `OIDC_ALLOWED_EMAIL_DOMAINS` | Optional auto-create of unknown SSO emails into one CoreEngine role (default off; domains required when JIT is on) |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase / PostgREST (optional registry REST) |
| `DIRECTUS_RUNTIME` | Must be `off` (legacy HTTP SDK refuse; GraphQL adapter is separate) |
| `SMTP_HOST` / `SMTP_FROM` | Optional BFF platform mail (invite, reset). Record and document email stays in n8n |
| `TASK_SCHEDULER_ENABLED` | In-process scheduled jobs inside this BFF. Default **on** (`false` / `0` / `off` disables). Set `false` on every extra instance; there is no lock that stops two processes from running the same job |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run bff:dev` | GraphQL BFF |
| `npm run build` | `vue-tsc -b && vite build` — **currently fails** on existing `vue-tsc` debt |
| `npm run build:ci` | `vite build` only (matches CI app job) |
| `npm run preview` | Preview production build |
| `npm run registry:check-cutover` | Migration health gate |
| `npm run registry:migrate` | Apply platform kernel SQL (PowerShell + `psql`) |
| `npm run registry:migrate:node` | Same kernel SQL via Node (`pg`); use this on Linux |
| `npm run platform:provision` | New customer DB via Node (`--domain`, `--admin-password`) — Mac/Linux/Windows |
| `npm run platform:provision:ps1` | Same provision via PowerShell (`-Domain`, `-AdminPassword`) |
| `npm run platform:provision:node` | Alias of `platform:provision` |
| `npm run platform:apply-pack` | Apply a domain pack onto an existing kernel DB |
| `npm run platform:export-pack` | Save live Setup config back into `supabase/domains/<id>` |

## Layout types

Entity layout schemas live under `src/interfaces` / config layout services and are stored in registry `layout_settings` (served by the BFF).
