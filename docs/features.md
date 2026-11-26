# Features and capability overview

Product surface for operators and implementers. For security layers see [`security.md`](./security.md). For install see [`setup.md`](./setup.md).

## Capability overview

| Area | CoreEngine today |
|------|------------------|
| **Workflow engine** | Partial — flow **keys** + handlers (HTTP / update record), record-automation **conditions**, Setup → **Tasks**. Visual multi-step designer lives in **n8n** or **Activepieces** (MIT). |
| **Permissions** | Partial — layered BFF security (auth → object CRUD → field sensitivity → owner row security + read-share). Layouts/nav are UX only. No manual share / Teams / hierarchy. See [`security.md`](./security.md). |
| **Owner transfer** | **Done** — Change Owner on record pages; BFF allows `owner_id` on update for Modify all / admin / current owner. Bulk list transfer still open. |
| **Teams / peer groups** | **Open** — MVP peer-queue read uses **same Role as owner**. True Teams subsets are future work. |
| **Authentication** | Partial — local JWT + optional **OIDC**. MFA on IdP. No SAML/SCIM. See [`oidc-sso.md`](./oidc-sso.md). |
| **Version control** | Partial — domain packs in git (`platform:export-pack` / `apply-pack`). No in-app config revision UI. |
| **Application builder** | Yes — Object Manager, Form / Record Page / list / tree designers, dashboards, role-scoped navigation, reports. |
| **Resource scheduler** | Yes — Scheduler block + Setup schedule slots. Clinic pack seeds practitioners / visits / appointments. |
| **Projects** | Yes — `pm_project` List / Board / Gantt, templates, stages, services. |
| **Automation** | Partial — record automations, flow keys, Message outbox → n8n / Activepieces, in-process scheduled jobs. Durable graphs in **n8n** or **Activepieces**. |
| **Reliable operations** | Partial — advisory locks + SKIP LOCKED claim for scheduled Message dispatch; failed-run monitoring; backup/upgrade smokes. Still prefer one scheduler process; durable Postgres queue (pg-boss / Graphile Worker) is the next step. |
| **Validation & business rules** | Partial — required / unique / unique groups; automations often used as rules. No dedicated validation-rules designer. |
| **Admin config audit** | Yes — append-only `config_audits` + GraphQL `configAudits` + Setup → **Config audit** browser (filter/paginate/detail). Pack apply remains git-based. See [`security.md`](./security.md#known-gaps-close-or-test). |
| **Integrations** | Partial — GraphQL BFF + REST CRUD, SOQL `/api/v1/query`, n8n templates + Activepieces (MIT) destination, optional Hasura/Directus. No first-party SaaS connector catalog. |

## Schema-driven UI

- Object Manager, role-scoped Block Layouts, list/tree/table designers, Form Builder canvas.
- **Per-role edit and view forms** and **per-role list filters (views)**.
- **Tree navigation + master-detail**, **batch insert**, **in-context edit dialogs**.
- **String vs Text fields** — String (1–255, default 255 → `varchar`) vs Text (256–131 072, default 32 768 → `text`); list search uses **Indexed** (`ILIKE`) for short strings and **Full-text search** (Postgres GIN / `tsvector`) for Text. Details: [`fields-and-search.md`](./fields-and-search.md).
- **Custom palette blocks** (Attachments, DocEngine, Tree table, Scheduler). Vertical UI via `registerCustomBlock` — see [`custom-blocks.md`](./custom-blocks.md).
- Block Layout **show / readonly conditions**, **inline editor**, **child value lookup**, **soft delete**.

## Application builder

- **Dashboards**, **navigation apps**, Record / form / list / tree pages via `layout_settings`.
- **Highlights + Compact Layout views** — Inline (single-line header, default) or Panel (grid with field spans).
- **Message timeline** — merges configured outgoing + incoming collections (incoming left / outgoing right), peer Lookup filter, Compact Layouts per side, Display Template links. Wire objects and link fields in the Record Page Builder (no hardcoded collections).

## Resource scheduler

- Scheduler palette block: resources + events, day/week calendars, drag create/move, availability against `crm_schedule` slots.
- **Setup → Schedule** — work-time templates and **Generate slots** (`generate_slots` job).

## Projects

- Platform collections (`pm_project`, `pm_stage`, …): List / Board / Gantt, lifecycle, templates, stage services and dependencies.
- Entry: `/projects` → object list → workspace.

## Automation & workflows

- Record automations (conditions, set fields, notify, break, trigger flow).
- **Setup → Connections** — `app_flow_triggers` (`http` to your n8n via `ce-{key}`, Activepieces via `flowId`, custom URL, or `update_record`). Failed runs in Setup.
- **Setup → Tasks** — scheduled jobs (**Call connection** → Setup → Connections / Activepieces or n8n, **Dispatch due messages**, purge archived, …). Promo price sync is an Activepieces Connection (`sync_promo_prices`), not an in-process job. Runner uses a **Postgres advisory lock** per task; set `TASK_SCHEDULER_ENABLED=false` on extra BFF replicas.
- **Sales Message outbox** — one Message row per send; due rows are claimed with **`FOR UPDATE SKIP LOCKED`** (`sending_since` + `attempts`). Stale `sending` rows are reclaimed after `staleMinutes` and stop after `maxAttempts`. Flow payload carries `idempotencyKey` (`ce-message-{id}`). Seed: `npm run registry:seed-n8n-pack-flows -- --pack=sales`. See [`n8n/README.md`](./n8n/README.md) and [`n8n-bff-flows.md`](./n8n-bff-flows.md).
- Complex visual orchestration: optional **n8n** (compose profile `automation`) or **Activepieces** (MIT; starts with the minimal Compose stack). Headless AP import: `npm run registry:seed-activepieces-flows` (CE admin JWT + project variables; Platform API keys not required). License notes: [`THIRD_PARTY.md`](../THIRD_PARTY.md) — n8n Sustainable Use limits hosting/resale; Activepieces is MIT — see [`activepieces/README.md`](./activepieces/README.md). A built-in Postgres queue remains an option for “reliable ops” without an external designer.

## Reliable operations

- Backup / restore: [`backup-restore.md`](./backup-restore.md) (`npm run registry:smoke-backup-restore`).
- Upgrades: [`upgrading.md`](./upgrading.md) (`npm run registry:smoke-upgrade`).
- Failed-run monitoring: Setup → Connections / Tasks; optional admin email (Setup → General or `FAILED_RUN_NOTIFY*`).
- **Scheduler today:** one enabled BFF + advisory lock + message claim locks. Enough for SMB single-node / careful HA.
- **Next (recommended):** Postgres-backed queue (**pg-boss** or **Graphile Worker**) for retries, failed-run history, and multi-instance workers — no new infra beyond the DB you already run, and no dependence on n8n for durable operations.

## Documents & list reports

- Document Templates + Field Mapping; list Document reports; tree-aware price lists.
- Interactive DocEngine via npm `@docengine/*` ([docEngine](https://github.com/YuriiOsypov/docEngine); local: `npm run docengine:use-local`). Automation generate: [`generate-document-api.md`](./generate-document-api.md).
- Cross-object file links (D2D).

## Reports, import/export, activity

- Pivot reports with drill-down to source records.
- Import / export for schema-driven objects.
- Per-entity Activity & Revision Tracking (mutations fail closed if audit write fails).

## Tree price lists

- Virtual payload: `item_group_tree_rows` (+ `$children`), DFS group shells, Tree `main.sort` within groups, currency formatting in docs. Legacy `$payload…` mapping paths still resolve.

## Platform kernel & packs

- New customer DB = new Postgres; kernel in `supabase/migrations/`, packs in `supabase/domains/` (Sales, Clinic, Pricing, Documents).
- Vertical matrix and how to build a pack: [`domain-packs.md`](./domain-packs.md).
- Runbooks: [`supabase/README.md`](../supabase/README.md) · [`sales`](../supabase/domains/sales/README.md).

## Data layer & integrations

- Registry in Supabase (`crm_schema`) via GraphQL BFF.
- Live records: pluggable `backend_target` (Supabase, PLATFORM, Hasura, Directus).
- REST: `/api/v1/:collection` CRUD, SOQL `/api/v1/query`, `expand=children`, `POST /api/v1/documents/generate`.
- GraphQL at `/graphql`.
