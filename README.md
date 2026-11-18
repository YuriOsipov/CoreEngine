# CoreEngine — operations suite for service and sales teams

Vue 3 + Vite + TypeScript. Schema-driven objects, layouts, documents, dashboards, and reports via GraphQL BFF + Supabase registry — with domain packs for vertical starters (Sales, Clinic, Pricing, Documents). Scope is sales, scheduling, projects, pricing, and documents.

**License:** MIT ([`LICENSE`](LICENSE)). Other components: [`THIRD_PARTY.md`](THIRD_PARTY.md). Support: [`SUPPORT.md`](SUPPORT.md) (community, no SLA). Vulnerabilities: [`SECURITY.md`](SECURITY.md). Upgrades: [`docs/upgrading.md`](docs/upgrading.md). Backups: [`docs/backup-restore.md`](docs/backup-restore.md).

**DocEngine (documents):** interactive HTML/PDF editing and server PDF/HTML render ship as a **sibling repo**, not this tree. It is **public** on GitHub ([YuriiOsypov/docEngine](https://github.com/YuriiOsypov/docEngine)) under the **MIT License** (same author). Local installs use `file:../docEngine` (Vue app + `crm-bff`); CI swaps those deps for in-repo stubs under `ci/stubs/` — **CI never exercises a real render**. Server output uses `@docengine/pdf-renderer` (**pdfmake + linkedom**, not a headless browser). Clone the sibling for `npm run dev`, real `generateDocument` PDF/HTML, and the optional Docker `ui` profile. Automation `POST /api/v1/documents/generate` / GraphQL `generateDocument` persists `doc_value` and can upload a PDF or HTML file (`outputFileId` + `downloadUrl`).

**Project status:** early-stage. Aimed at **SMB / mid-market teams (tens to a few hundred users)** — not full Salesforce Enterprise sharing. The idea is clear (git-versioned domain packs, role layouts, pricing/document features), but CoreEngine is **not yet** a drop-in NocoBase or Salesforce alternative for production adoption. Owner row security + role View/Modify all cover the common “my rows / manager sees all” pattern. Durable multi-step runs still belong in **n8n** (ready-made templates + failed-run monitoring in Setup; no in-process durable queue yet). Interactive DocEngine in the UI needs the sibling checkout locally. **OIDC SSO** via an external IdP covers the SMB / mid-market SSO ask; **SAML and SCIM** are not implemented yet.

**Operations suite for service and sales teams:** sales, scheduling, projects, pricing, and documents. CoreEngine takes the core Salesforce ideas (custom objects, relationships, role-based layouts, record pages with related lists, and in-app document generation) and delivers them as a modern, self-hosted, free product with git-versioned domain packs — without the per-seat cost or complexity of the full Salesforce stack. The lightweight Docker option is [`docker-compose.minimal.yml`](docker-compose.minimal.yml) (Postgres + BFF). The default `docker compose` runs the full self-hosted Supabase suite.

Build internal and vertical applications with custom objects, relationships, role-specific forms, and in-app document generation — without starting from a blank low-code canvas.

**CoreEngine is for teams that want:**
- A real data model they control (custom objects + relationships)
- Different edit/view forms per role (Sales Rep vs Manager vs Pricing)
- Domain starters they can version in git (Sales + Pricing, Clinic, Documents)
- **Resource scheduling** (people / rooms / equipment calendars) and **Projects** (stages, board, Gantt, templates)
- In-app document generation (DocEngine HTML/PDF in the browser) and price-list trees — fill a template and download HTML or PDF
- Automation document generate for n8n: populate values, persist `doc_value`, render/upload PDF or HTML (`outputFileId` + `downloadUrl`)
- A GraphQL + REST API they can automate with n8n (records, query, flows, document generate)

**It is not trying to be:**
- A full enterprise Salesforce replacement (security, AppExchange, and automation depth still differ)
- A Twenty-style developer platform CRM (full `twenty-sdk` apps, sandboxed front components, CLI-synced TypeScript workspace)
- A free-form internal-tools canvas like Retool
- A no-code workflow product with a visual multi-step designer (use n8n on top of CoreEngine)
- Inbound email or calendar sync (EspoCRM has that)
- Accounting or inventory (ERPNext and Odoo have those)

**Positioning vs Twenty:** Twenty wins developer-led teams and ISVs who want to *build products on* the CRM. CoreEngine’s position wins operators / vertical implementers who want Setup + packs + documents, with optional engineer-owned blocks — without adopting a full app SDK.

### Quick comparison

| Need | CoreEngine | NocoBase | Twenty | Retool | Salesforce |
|------|------------|----------|--------|--------|------------|
| Custom objects + relationships | Strong | Excellent | Strong | Query existing data | Excellent |
| Role layouts, list filters, object CRUD, field-level tiers | Strong (UX + BFF); **owner RLS** + role **View/Modify all**; no manual share yet | Strong (field + record/sharing rules) | Strong object ACL + workspace roles (not Salesforce-style FLS/sharing) | Build separate UIs | Excellent |
| Owner / row-level access | Opt-in owner RLS + View/Modify all; no share/groups/hierarchy | Record / sharing rules | Workspace / object permissions | App logic | Sharing rules / teams / hierarchy |
| SSO (OIDC) / MFA | OIDC via external IdP; MFA on IdP; local login toggle; **no SAML/SCIM** | Auth plugins / IdP (incl. OIDC/SAML depending on plugin) | OIDC + SAML SSO on Organization plan (self-host needs paid license); Google/Microsoft social login without it | IdP / SSO (product-dependent) | Full (SAML, SCIM, …) |
| AI / MCP assistants | Not in current scope; REST/GraphQL API available | Built-in MCP server + AI Employees plugins | In-product AI agents | Retool AI | Agentforce (Einstein brand still on some predictive features) |
| CRM pipeline | Sales starter pack | Build / plugins | Strong | Build it | Excellent |
| Campaign → promo pricing engine | Built-in | Build it | Custom objects | Build it | Custom / AppExchange |
| Resource scheduling (internal calendars) | Built-in block + Setup schedule slots | Plugins / build | Limited | Build it | Service Cloud / custom |
| Projects (stages / board / Gantt) | Built-in PM workspace + templates | Plugins / build | Limited | Build it | Custom / AppExchange |
| Document generation (PDF/HTML) | UI DocEngine + server generate (persist `doc_value` + PDF/HTML file) | Plugins / build | Limited | Build it | Good (packages) |
| Visual multi-step / **durable** workflows | Via **n8n** (not in-process durable queue) | Built-in (approvals, jobs) | Built-in + AI agents | Built-in | Flow + Apex |
| Config as code (packs in git) | Yes (domain packs + Setup) | Partial / app source | Yes (twenty-sdk, TypeScript apps in git) | App source | Metadata / DX |
| Custom UI extension | Built-in blocks + `registerCustomBlock` (sibling package) | Plugins | Sandboxed front components via SDK | Custom apps | Lightning / AppExchange |
| Community / product maturity | Early-stage | Established OSS | Growing OSS CRM | Mature commercial | Mature enterprise |
| Price | Free / self-hosted (MIT) | Free Core (OSS) / commercial options | Free / paid cloud | Paid | Expensive |

**Not targeting enterprise sharing hierarchies, SAML/SCIM or AI agents for now.** For multi-step durable runs, use **n8n** against the REST/GraphQL API.

---

## Capability overview

How CoreEngine maps to common platform checklist items today:

| Area | CoreEngine today |
|------|------------------|
| **Workflow engine** | Partial — flow **keys** + handlers (HTTP / update record), record-automation **conditions**, Setup → **Tasks** (scheduled jobs). Visual multi-step designer lives in **n8n** (or similar), not inside CoreEngine. |
| **Permissions** | Partial — **Object-level CRUD** + **field-level sensitivity tiers** + opt-in **owner row security** with role **View all / Modify all** at the BFF. **Not** manual share / groups / hierarchy. Aimed at SMB / mid-market; richer sharing later if demos need handoffs. |
| **Authentication** | Partial — local email/password via BFF JWT (`/auth/login`, refresh); disable with `AUTH_LOCAL_LOGIN_ENABLED=false`. Optional **OIDC SSO** via external IdP covers the **SMB / mid-market SSO ask**; MFA is IdP-only. **No SAML or SCIM** yet. SSO refresh re-checks IdP userinfo (when IdP tokens were stored at login) so IdP disable ends the CE session at next refresh; deactivate in Setup for immediate revoke. Roles stay in CoreEngine — IdP groups are not synced. See [`docs/oidc-sso.md`](docs/oidc-sso.md). |
| **Version control** | Partial — schemas, layouts, roles, and templates ship as **domain packs** (JSON under `supabase/domains/`) with `platform:export-pack` / `apply-pack`; versioned in **git**. No in-app config revision UI. |
| **Application builder** | Yes — Object Manager, Form / Record Page / list / tree designers, **dashboards**, role-scoped **navigation** apps, reports. Pages are schema/nav targets (not a free-form CMS). |
| **Resource scheduler** | Yes — place a **Scheduler** block on a layout; bind resource + event collections (optional resource tree, filters, availability windows). Day/week calendars, drag to create/move, create/edit dialogs. Setup → **Schedule** expands provider work-time templates into dated slots (`generate_slots`). Clinic pack uses practitioners / visits / appointments. |
| **Projects** | Yes — `pm_project` workspace with **List / Board / Gantt**, stages, services on stages, dependencies, lifecycle, progress, base price / PM cost. Apply a **project template** to create a dated stage plan. |
| **Automation** | Partial — record automations (set fields, notify, break, **trigger flow**), outbound **webhooks** via flow keys, Sales **Message outbox** (multichannel notifications and automations: queue / schedule / Send → n8n channel connectors, one Message row per send), in-process **scheduled jobs** (`TASK_SCHEDULER_ENABLED`, default on). Failed flow/task runs are listed in Setup; optional admin email (needs SMTP). Retries and durable multi-step graphs live in **n8n**. |
| **Reliable operations** | **Partial** — optional Docker **n8n** profile + pack flow keys (`target=n8n` → `/webhook/ce-{key}`) + Message outbox write-back (SMTP + multi-file attach) + quote PDF / appointment reminder + failed-execution alert ([`docs/n8n/README.md`](docs/n8n/README.md)). Setup → Flows / Tasks → **Failed runs**; optional admin email (Setup → General → Failed-run alerts, or `FAILED_RUN_NOTIFY_EMAIL`). Backup/restore + upgrade smoke: [`docs/backup-restore.md`](docs/backup-restore.md), [`docs/upgrading.md`](docs/upgrading.md). Still no durable in-process queue, retry, or leader election — run the scheduler on one BFF. |
| **Validation & business rules** | Partial — field required / unique / unique groups exist. Record automations (conditions + notify / set fields / break) are commonly used for validation rules today. No dedicated validation-rules designer or field-level error blocking yet. |
| **Admin config audit** | **Open** — record **Activity & Revision Tracking** covers business data; no audit history yet for administrative configuration changes (entities, fields, layouts, roles, automations, etc.). |
| **Integrations** | Partial — GraphQL BFF + REST CRUD, SOQL-style `/api/v1/query`, n8n runbook + importable templates ([`docs/n8n/README.md`](docs/n8n/README.md)), optional Hasura/Directus record backends. **`POST /api/v1/documents/generate`** persists `doc_value` and can return a rendered PDF/HTML file. Interactive DocEngine in the UI works with the sibling. No first-party SaaS connector catalog. |

---

## Features

### Schema-driven UI
- Object Manager, role-scoped Block Layouts, list/tree/table designers, and Form Builder canvas.
- **Per-role edit and view forms** — different layouts for each user group on the same object.
- **Per-role list filters (views)** — each role can have its own saved filters / list views for an object’s record list.
- **Tree navigation + master-detail** — hierarchical group trees (e.g. Item Groups) with filtered lists and related-detail panels (Item → Item Prices) without custom code.
- **Batch insert** — multi-select related records (e.g. Opportunity Items) from a hierarchical catalog with automatic price resolution and running totals.
- **In-context edit dialogs** — open create/edit forms in a modal on the same list or detail page without full navigation.
- **Custom palette blocks** (Attachments, DocEngine, Tree table picker, Scheduler) can be placed more than once on a Block Layout — they stay available after drop. **Vertical / customer UI** lives in a sibling package via `registerCustomBlock`; wire it from gitignored `src/extensions/register.local.ts` (copy from `register.local.example.ts`) so CoreEngine upgrades do not overwrite your imports. App Admin places blocks in Setup. See [`docs/custom-blocks.md`](docs/custom-blocks.md).
- Block Layout **show / readonly conditions** on fields and groups (visibility and editability driven by record values).
- **Inline editor** in object / related lists for editing cells without opening the record.
- **Child value lookup** on fields — resolve a value from a related / child collection (with optional parent-field filters), e.g. Item Price → Price by Item and Account price group.
- **Soft delete** for entities — records are marked deleted (and filtered from default lists) instead of permanently removed, with restore where supported.

### Application builder
- **Dashboards** — Setup designer + runtime metric/chart/label panels.
- **Navigation apps** — role-scoped folders, entity lists, dashboards, reports, and home routes.
- **Record / form / list / tree** pages driven by `layout_settings` (no hard-coded detail forms).

### Resource scheduler
- Drop a **Scheduler** palette block on a Block Layout (same family as Attachments / DocEngine). Role-scoped scheduler layouts map:
  - **Resources** — one or more collections (people, rooms, equipment), optional hierarchy tree + filters
  - **Events** — appointment / visit collection with start/end and resource FK fields
- Runtime calendar (day / week / resource timeline): create and drag events, open create/edit dialogs, optional delete, status colors, compact related details.
- Optional **availability** guard against generated intake / block slots (`crm_schedule`) so bookings stay inside work windows.
- Optional **template expansion** — recurrence-style rules on records expand into virtual events for the visible range.
- **Setup → Schedule** — manage provider work-time templates and **Generate slots** for a period (also runnable as the `generate_slots` background job). Clinic pack seeds `patient`, `practitioner`, `visit`, and `appointment` as a starter.

### Projects
- Built-in project management on platform collections (`pm_project`, `pm_stage`, `pm_stage_item`, plus template collections).
- Project workspace: **List**, **Board**, and **Gantt** views; lifecycle (planned / active / on hold / done / cancelled); progress; base price and PM cost.
- Stages with status, dates, dependencies, milestones, and linked **services** (catalog items) that can block completion until delivered.
- **Project templates** — define a reusable stage plan (offsets, durations, default services) and apply it to create a project with a scheduled stage timeline.
- Entry URL `/projects` opens the standard object list for `pm_project`; open a record for the workspace.

### Automation & workflows
- **Record automations** on create/update/delete: conditions (AND/OR, require-changed), set fields, notify, break, trigger a flow key.
- **Setup → Flows** — named `app_flow_triggers` (`http` to **your n8n** via `ce-{key}` paths, custom URL, or `update_record`). Flow key stays without prefix; Destination **Your n8n** calls `{N8N_BASE_URL}/webhook/ce-{key}`. Prefer keys over raw URLs in automations. **Failed runs** lists recent outbound errors (`app_flow_dispatches`, 90 days).
- **Setup → Tasks** — scheduled background jobs (e.g. Sync promo prices, **Dispatch due messages**, notifications via flow triggers). The runner lives in the BFF process and is on unless `TASK_SCHEDULER_ENABLED=false`. A second BFF instance will tick the same table and can run the same job again. **Failed runs** lists recent `FAILED` executions; per-task **History** remains available.
- **Sales Message outbox** — multichannel notifications and automations. n8n supplies the channel connectors. Each send is one Message row (no in-app workflow designer, and no conversation threads):
  - Create Message → automation **queue** (`delivery_status=queued`). Empty **Scheduled send at** → immediate flow `dispatch_outbound_message`; otherwise stay queued until Tasks job **`dispatch_due_messages`** (every 5 min) marks `sending` and triggers the same flow.
  - Record page **Send** re-triggers that flow (retry / send-now / rows created before wiring).
  - **To user** + list view **For me** (+ RLS `rowLevelReadAlsoIf`) lists Message rows addressed to you; Type Internal (4) for user→user notify.
  - n8n connectors route Email / WhatsApp / Telegram / Internal; Email uses SMTP (`SMTP_FROM` + n8n **CoreEngine SMTP** credential), attaches **all** Message files (and optional generated PDF when Opportunity + template env are set), then PATCHes `result` / `delivery_status`.
  - Seed: `npm run registry:seed-n8n-pack-flows -- --pack=sales` (flows + dual automations + due-messages task). Import/activate [`docs/n8n/dispatch-outbound-message.workflow.json`](docs/n8n/dispatch-outbound-message.workflow.json). Also `send_quote_pdf` / Clinic `send_appointment_reminder`. Catalog: [`docs/n8n/README.md`](docs/n8n/README.md). Runbook: [`docs/n8n-bff-flows.md`](docs/n8n-bff-flows.md).
- Complex branching / retries / multi-system orchestration: use **n8n** against CoreEngine REST/GraphQL. Optional compose profile `automation` references upstream `n8nio/n8n`. Customers pull that image themselves (`docker compose -f docker-compose.minimal.yml --profile automation up -d n8n`). The installers do not start n8n, and the CoreEngine images do not contain it.
- n8n Community Edition is free for internal business use; hosted or resold use needs a separate agreement with n8n. The Sustainable Use License allows internal business use. It bars white-labeling n8n for customers, and hosting n8n and charging for access. Putting n8n inside a commercial product or appliance is outside that grant. Consulting on a customer’s own instance is a different matter: sell implementation and support, not “n8n access.” Managed hosting or a true bundle needs a commercial agreement. n8n’s license contact is [license@n8n.io](mailto:license@n8n.io). This note is not legal advice; confirm with them.
- Customers who outgrow Community can move to a paid n8n plan for SSO, Projects and Git, without changing your webhook contract (`{N8N_BASE_URL}/webhook/ce-{key}` and `X-CRM-Flow-Secret`).
- **Failed-run monitoring:** Setup → Flows / Tasks for in-process failures. Optional **admin email**: Setup → General → Failed-run alerts (platform SMTP), or `FAILED_RUN_NOTIFY` / `FAILED_RUN_NOTIFY_EMAIL` (15‑minute debounce per key). n8n execution errors stay in n8n (Executions filter + the failed-execution alert template → Slack/Telegram).

### Reliable operations
- **Backup / restore** — Postgres dump on the host, secrets offline (including `N8N_ENCRYPTION_KEY`), Storage files, and the `coreengine_n8n` volume when n8n is in use: [`docs/backup-restore.md`](docs/backup-restore.md). Check with `npm run registry:smoke-backup-restore` (`pg_dump` / `pg_restore` required; scratch restore needs `CREATEDB`).
- **Upgrades** — pull → kernel migrate → rebuild/restart (**do not** re-provision casually): [`docs/upgrading.md`](docs/upgrading.md). `npm run registry:smoke-upgrade` applies migrate twice (second pass must be empty) and checks `/health`.

### Permissions & authentication
- **Object-level CRUD** (+ import/export) matrix per role — **enforced by the BFF** on GraphQL/REST record operations; admins bypass; role preview in the UI. Setup → Roles also grants optional **View all** / **Modify all** per object (see owner row security below).
- **Field-level security (sensitivity flags)** — mark a field Restricted or Confidential in Setup → Fields; grant a per-role max read/edit tier in Setup → Roles. Platform default is open (new fields = None) until an admin marks them; a role with no grant sees none of the marked ones. Admins bypass. UI hide alone is not enough — the BFF enforces.
  - **Entity / pack default:** Setup → Entity parameters → **Default field security level** (`backend_config.defaultFieldSensitivity`, also settable in domain-pack entity JSON). New fields inherit that tier when create omits an explicit sensitivity; existing fields are unchanged.
  - **Covered (unit-tested gates / redaction):** record reads & writes; filters, sorts, aggregates — FLS `assertReadableQuery` runs in the facade **before** every store (Supabase, Hasura, Directus). Dotted SOQL keys like `manager.salary` are hop-checked then expanded to nested filters for Hasura/Directus (same shape Supabase EXISTS already used). List search: Supabase/Hasura exclude parent unreadable fields **and** M2O “Use in search” hops (related entity read ACL + template/fallback label sensitivity); Directus omits global search when any parent field is unreadable. Also: revision snapshot redaction; export/import pickers; upsert / unique-key lookups; `expand=children`; bulk update-by-filter / related; unique-violation API text (no Postgres `detail`); formula/rollup inherit max source sensitivity (+ Setup clamp); facade `access` required (`{ me }` / `SYSTEM_RECORD_ACCESS`); production boot refuses missing sensitivity columns; hard delete audits **before** erase (`hardDeleteAfterAudit`); refresh-token reuse revokes all sessions (migration `202611120001_refresh_token_reuse.sql`).
  - **Documents vs FLS:** `generateDocument` freezes whatever the **generating caller** can read (source row is FLS-redacted; `valuesOverride` keys that match unreadable fields / mapping targets are dropped; freeform automation keys that are not source fields still pass). The persisted `doc_value` / PDF/HTML then follows **document-object ACL** (admin-only matrix today) — anyone later allowed to open that document object sees the frozen values, even if they could not read those source fields on the live record. Interactive DocEngine editing of stored docs is the same document ACL, not live source-field tiers. **Still open elsewhere:** **ddlSync** does not enforce sensitivity; record automations `setFields` / `notify` are trusted server rules; child value lookups have no dedicated FLS test; rollup **filters** on sensitive child fields and non-`{{…}}` formula idioms are not fully modeled; COUNT(`*`) rollups have no value-field tier; field/role security caches use a **5s TTL** plus a DB **epoch** (`app_cache_epochs`) so Setup clears propagate across BFF instances; create/update/soft-delete/restore audits are **fail-closed** (`auditAfterMutation`, with best-effort compensate) like hard delete.
- **Field sensitivity is column-level.** Flags mean “this column is sensitive for most roles on every record of the object.” They do **not** by themselves cover “Sales can see salary only for their own team.”
- **Owner row security** — opt-in per object so users without View/Modify all only reach rows they own (`owner_id`). Kernel default is **off**. The **Sales pack** turns it **on** for `account`, `contact`, `opportunity`, `message`, and `opportunity_item` (catalog / pricing entities stay shared). Fits SMB / mid “private to creator + manager sees all” without Salesforce sharing rules.
  - **Enable object:** Setup → Entity parameters → **Owner row security**, or `backendConfig.rowLevelSecurity = "owner"` in pack entity JSON (`null` / omit = off). Optional **Inherit owner from parent** (`backendConfig.inheritOwnerFrom` = M2O field api_name) copies the parent’s **`owner_id`** onto new children (sales `opportunity_item` → `opportunity`). **Created By** (`user_created`) stays the creating actor. Pack apply/export round-trip both flags. Clients cannot set `owner_id` / audit fields.
  - **Typical setup:** Reps = Read/Update on the object (owner filter applies). Managers = same CRUD **plus View all** (and **Modify all** if they may edit anyone’s rows). Sales pack seeds **Sales Manager** with View/Modify all on those CRM objects; **Sales Rep** stays owner-scoped; **Integration** is a non-admin full_pack role for n8n. Platform admins always bypass. Apply kernel migration `202611130002_role_permissions_view_modify_all.sql` (`npm run registry:migrate`) before using the new role columns.
  - **Enforced (BFF facade):** list, get-by-id, update, soft-delete, restore, aggregates, **live rollups** (child aggregates), **M2O list search**, **file read/write** on parent records, and **generateDocument** source-record access. Without View all → `owner_id = me.id`. Unauthorized get/update/delete → `Permission denied`. Soft-delete cascades run as system after the parent ownership check. Stored (non-live) rollup recompute stays system-wide truth — so live vs stored quote totals can still differ by caller.
  - **Bypass:** admins; `SYSTEM_RECORD_ACCESS`; role **View all** (read/list/aggregate, still needs Read); role **Modify all** (update/delete/restore, implies View all, still needs Update/Delete). **View as role** applies the previewed role’s owner / View-all rules.
  - **Not yet:** manual share, public groups, role hierarchy, criteria rules, or UI/API **transfer** of `owner_id` (a departing rep’s rows stay reachable by managers with View all / admins). Role **list filters/views** are UX-only — not an API substitute for owner security.
  - **n8n / automation login:** the BFF accepts **any active app user** JWT for record REST/GraphQL (admin is not required). `npm run registry:seed-n8n-automation-user` defaults to non-admin **Integration** (creates the role + full object CRUD if missing); pass `--admin` only when Setup access is required. With owner RLS on, creates stamp `owner_id` (and audit `user_created`) to that user — Integration-owned leads stay private unless the role has **View all**. Setup / registry mutations still need admin.
  - **Tests:** `crm-bff/src/services/rowLevelSecurity.test.ts` (includes View all / Modify all bypass cases).
- **Admin “View as role”** — sends `X-Role-Preview` so object ACL, field security, and owner row security follow the selected role **without creating a test user**. Setup admin mutations and GraphQL `me` keep real admin identity; audit stamps still record the admin as the actor.
- **Per-role layouts** and **per-role list filters/views** (each role’s own record-list filters). Conditional field/group **hide / readonly** on layouts is UI behavior on top of, not instead of, field-level API security.
- **Auth:** BFF local login (`VITE_AUTH_MODE=bff`) issuing verified Bearer access tokens (**15-minute** TTL) + refresh tokens (**30-day** TTL). Optional **OIDC SSO** (`OIDC_ENABLED`) — Authorization Code + PKCE against an external IdP (Keycloak, Auth0, Entra, …); BFF verifies the ID token and issues the same CoreEngine session. That path covers the **SMB / mid-market SSO ask**; **SAML and SCIM** are out of scope for now. **Roles and admin flags stay in CoreEngine** (Setup → Users / Roles) — IdP groups/roles are not synced. MFA lives on the IdP. Local password login defaults **on**; set `AUTH_LOCAL_LOGIN_ENABLED=false` for SSO-only (UI hides the form; `POST /auth/login` returns 403). Disabling a user **only at the IdP** does not flip `app_users.is_active`, but SSO refresh re-validates IdP userinfo when an IdP refresh token is stored (default `OIDC_CHECK_ON_REFRESH=true`, scopes default include `offline_access`); reject then revokes CE refresh tokens. Without an IdP refresh token, a failed userinfo check is skipped. Deactivate in Setup for immediate API deny. See **OIDC SSO (Keycloak)** below and [`docs/oidc-sso.md`](docs/oidc-sso.md).

### Documents & list reports
- Setup → Document Templates with Field Mapping against live or sample `$payload`.
- **List Document report** actions build one DocEngine document from filtered / visible list rows (`$payload.records`, `$payload.meta.filter`).
- **Tree-aware price lists** — generate grouped Price List documents (by Item Group hierarchy) for a selected Price Group directly from the Item Price list.
- HTML and PDF preview expand **array-sourced sections** so each mapped group instance renders (not only the first).
- **In the app, DocEngine works** (fill a template, HTML preview, PDF download) when the public MIT sibling [docEngine](https://github.com/YuriiOsypov/docEngine) is checked out next to this repo. That path stays in the browser.
- **Automation generate:** `POST /api/v1/documents/generate` and GraphQL `generateDocument` freeze the generating caller’s readable snapshot (FLS-redacted source + filtered `valuesOverride`), persist `doc_value` / PDF/HTML under **document-object ACL** afterward (later readers of the document are not re-checked against live source-field tiers). Real render needs sibling `../docEngine` (**pdfmake + linkedom**, not Chromium); CI uses stubs and does not test a real render. Render runs in a **worker thread** with hard kill on timeout (`worker.terminate()`). Caps: `DOC_RENDER_TIMEOUT_MS` (30s), `DOC_RENDER_MAX_CONCURRENCY` (2), `DOC_RENDER_MAX_OUTPUT_BYTES` (25 MiB). Contract: [`docs/generate-document-api.md`](docs/generate-document-api.md).
- **Cross-object files (D2D)** — attach and link the same files across different objects and related records.

### Reports
- Pivot / report views with a **drill-down** option to open the source records behind a summarized cell.

### Import / export
- Import and export support for moving records in and out of schema-driven objects.

### Activity & Revision Tracking
- Per-entity accountability (activity only, or activity + revisions) for audit history on create/update/delete — GraphQL/REST mutations **fail closed** if the audit write fails (best-effort compensate).

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
- `POST /api/v1/documents/generate` — populate + persist `doc_value` + PDF/HTML render/upload (`outputFileId` / `downloadUrl`).
- **Record + children in one call:** `GET /api/v1/:collection/:id?expand=children` returns the parent plus `_children` (every entity with an M2O FK to that record, e.g. Opportunity → `quote`) and `_files` (attachments). Optional `childLimit`, `expand=children,nofiles`.
- GraphQL at `/graphql` for the Vue app and advanced clients.
- n8n: optional compose profile `automation` pulls upstream `n8nio/n8n` (UI on `127.0.0.1` only; fixed `N8N_ENCRYPTION_KEY`; Git/shell nodes excluded). Not inside the CoreEngine image or installer. Setup → Flows **Your n8n** (`ce-{key}` + `X-CRM-Flow-Secret`). Non-admin Integration login + REST/GraphQL write-back (Modify all on `message` for outbox PATCH). Record/document email is sent from n8n (SMTP credential + `SMTP_FROM`), not BFF platform mail. License: [`THIRD_PARTY.md`](THIRD_PARTY.md). Hardening + templates: [`docs/n8n/README.md`](docs/n8n/README.md). Runbook: [`docs/n8n-bff-flows.md`](docs/n8n-bff-flows.md).

---

## Setup

**Support:** community best-effort, no SLA — [`SUPPORT.md`](SUPPORT.md).  
**Upgrades** (existing DB): [`docs/upgrading.md`](docs/upgrading.md) — pull → kernel migrate → rebuild/restart (**do not** re-provision casually). Prove with `npm run registry:smoke-upgrade`.  
**Backups:** [`docs/backup-restore.md`](docs/backup-restore.md) — dump lands on the **host** (not in a Docker volume). Prove with `npm run registry:smoke-backup-restore`.  
**Failed runs:** Setup → Flows / Tasks; optional admin email in Setup → General (needs SMTP).

### Quick start — lightweight (recommended try-out)

Postgres + BFF only ([`docker-compose.minimal.yml`](docker-compose.minimal.yml)). No Storage / Studio / PostgREST. Needs Docker. One command:

```bash
# Windows (PowerShell):
npm run install:minimal
# or: powershell -File ./scripts/install-minimal.ps1 -Domain sales -WithUi

# macOS / Linux:
chmod +x ./scripts/install-minimal.sh
./scripts/install-minimal.sh --domain sales --with-ui
```

The script creates `.env` from [`.env.docker.example`](.env.docker.example) if missing, sets `POSTGRES_DB=coreengine`, generates DB passwords when empty, syncs `supabase/.env`, starts Postgres, provisions (Sales pack by default), and starts the BFF. Optional `--with-ui` / `-WithUi` builds the web profile (**DocEngine CI stubs** — full interactive editor needs sibling [`../docEngine`](https://github.com/YuriiOsypov/docEngine) + `npm run dev`).

- BFF health: http://localhost:4000/health  
- UI (if started): http://localhost:8080  
- Login: `admin@example.com` with the password printed by provision (or pass `--admin-password` / `-AdminPassword`)

Manual equivalent (same compose file): see comments at the top of [`docker-compose.minimal.yml`](docker-compose.minimal.yml).

### Quick start — all-in-one Docker (full Supabase)

Self-hosted Supabase (Postgres, Envoy, Auth, PostgREST, Storage, Studio, …) + CoreEngine BFF + optional web UI. Expect **several GB of RAM**.

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
- Known weak bootstrap admin passwords (`admin12345`, `ChangeMeNow!`, …) are refused on **every** BFF start unless `ALLOW_INSECURE_BOOTSTRAP=true`. Compose defaults `NODE_ENV=production` on the BFF service. Use a unique admin password from provision.

**External host Supabase** (BFF in Docker, DB/Envoy on the host): [`docker-compose.supabase.yml`](docker-compose.supabase.yml) overlay on the minimal file.  
Optional Hasura: [`docs/hasura/docker-compose.yaml`](docs/hasura/docker-compose.yaml).  
Optional Keycloak (OIDC SSO): [`docker-compose.keycloak.yml`](docker-compose.keycloak.yml) (`--profile oidc`) — see below and [`docs/oidc-sso.md`](docs/oidc-sso.md).  
Vendored Supabase pin: [`docker/supabase/VENDOR.md`](docker/supabase/VENDOR.md).

### OIDC SSO (Keycloak)

CoreEngine does **not** run an OAuth authorization server. Use an external OIDC IdP; the BFF is the relying party. Local email/password login defaults on; set `AUTH_LOCAL_LOGIN_ENABLED=false` for SSO-only so IdP MFA cannot be bypassed via `/auth/login`.

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
# Recommended in production (seals IdP tokens independently of AUTH_JWT_SECRET):
# OIDC_TOKEN_ENCRYPTION_KEY=
# Defaults include offline_access when OIDC_CHECK_ON_REFRESH is on; override with OIDC_SCOPES=
```

Set `OIDC_CLIENT_SECRET` from Keycloak → Clients → `coreengine` → Credentials (leave empty in committed examples).

Login page shows **Sign in with Keycloak** when `GET http://localhost:4000/auth/oidc/status` returns `enabled: true`.

**New users (default — JIT off):**

1. Create the user in CoreEngine (**Setup → Users**) with email + **non-admin** role.
2. Create the same email in Keycloak (`coreengine` realm → Users → Add user; set password; Email verified On).
3. Sign in via **Sign in with Keycloak** — first login links by email (`email_verified` required). Admins must set `oidc_issuer`/`oidc_subject` instead of email-link.

Keycloak Groups / realm roles are **not** mapped to CoreEngine roles. Change ACL in Setup → Users / Roles. Optional JIT (`OIDC_JIT_PROVISION` + `OIDC_DEFAULT_ROLE_BACKEND_ID` + `OIDC_ALLOWED_EMAIL_DOMAINS`) can auto-create unknown emails into one default role — still no IdP group sync. Admin accounts are never email-linked; set `oidc_issuer`/`oidc_subject` explicitly.

**Deprovisioning:** there is no SCIM / IdP→CoreEngine sync. Prefer deactivate in **Setup → Users** (`is_active = false`) for immediate deny. For SSO sessions, refresh re-checks IdP userinfo when sealed IdP tokens are present (default `OIDC_CHECK_ON_REFRESH=true`; scopes default include `offline_access` so Auth0/Entra return a refresh token). IdP reject with a stored IdP refresh token revokes CE refresh tokens (optional `OIDC_DEACTIVATE_ON_IDP_REJECT=true` also sets `is_active=false`). If there is **no** IdP refresh token (access-only), a failed userinfo check is **skipped** rather than locking the user out. Set `OIDC_TOKEN_ENCRYPTION_KEY` in production so sealing is not tied to `AUTH_JWT_SECRET`. Access JWT still lasts up to ~15 minutes after revoke. Full detail: [`docs/oidc-sso.md`](docs/oidc-sso.md).

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
- **Bootstrap admin passwords** — known weak passwords on bootstrap emails (`admin12345`, `ChangeMeNow!`, …) are refused on **every** start unless `ALLOW_INSECURE_BOOTSTRAP=true` (local escape hatch).

See [`supabase/README.md`](supabase/README.md) for the platform kernel + domain packs (Sales / Clinic).

### Security model and deployment checklist

What the BFF enforces today, and what operators must still do in production:

| Topic | Behavior |
|-------|----------|
| **JWTs** | Access tokens are HMAC-signed, algorithm-pinned, and verified on each guarded request. Access TTL is **15 minutes** (`ACCESS_TTL_SEC`); refresh tokens rotate the session. Reuse of a rotated refresh token revokes **all** sessions for that user. Placeholder / too-short `AUTH_JWT_SECRET` values are refused at every BFF start. |
| **OIDC SSO** | Optional external IdP (`OIDC_*`). BFF is the relying party (not an authorization server). ID tokens are verified via JWKS; users link by `oidc_issuer`/`oidc_subject` or verified email. Covers the **SMB / mid-market SSO ask**; **no SAML or SCIM** yet. **Roles stay in CoreEngine** — IdP groups are not synced. MFA is an IdP setting. Local login defaults on; set `AUTH_LOCAL_LOGIN_ENABLED=false` for SSO-only. SSO refresh re-checks IdP userinfo by default; deactivate in Setup (`is_active`) for immediate revoke. |
| **Admin status** | Taken from the **database** (`is_admin` / role flags via `fetchMe`), not trusted from JWT / IdP claims. Setup stays on the real admin identity even when `X-Role-Preview` is set. |
| **Setup mutations** | GraphQL Setup / registry mutations require **admin** (`requireAdminAccess`). Non-admins cannot change entities, fields, roles, layouts, or packs through those resolvers. |
| **Field tiers** | Field sensitivity `0` / `1` / `2` + per-role max read/edit — enforced on record GraphQL/REST/SOQL paths (see Permissions). UI hide alone is not enough. **Production refuses to start** if sensitivity columns are missing. In-memory caches use a **5s TTL** plus DB epoch invalidation across BFF instances. Generate freezes the caller’s readable snapshot; later reads of `doc_value` / PDF use document-object ACL (not live source FLS). |
| **Owner row security** | Opt-in per entity (`rowLevelSecurity: owner`). Sharing uses system field `owner_id` (audit `user_created` is the creating actor). Optional `inheritOwnerFrom` (M2O) copies parent `owner_id` on create — sales `opportunity_item` uses `opportunity`. Managers: **View all** / **Modify all**. Live rollups are per-caller; stored rollups are system-wide. Admins / system bypass. |
| **Document render** | Server PDF/HTML via sibling `@docengine/pdf-renderer` (pdfmake + linkedom) in a **worker thread**; timeout calls `worker.terminate()` (hard kill), plus concurrency / output size caps (`DOC_RENDER_*`). CI uses stubs — real render is not covered. |
| **Hasura / Directus** | Optional record backends for the BFF only. Keep their admin consoles, GraphQL endpoints, and secrets **off public networks**; clients talk to CoreEngine BFF, not those engines directly. |
| **Scheduler** | In-process (`TASK_SCHEDULER_ENABLED`, default on). Run it on **one** BFF instance; disable on extras — there is no leader election. Failed runs appear under Setup → Tasks; optional admin email via Setup → General / `FAILED_RUN_NOTIFY*`. |
| **Flows** | `FLOWS_TRIGGER_REQUIRE_AUTH=false` is **refused in production**. HTTP service-key callers still respect flow `allowedFields` on payload patches (trusted in-process `system` invokers do not). Failed outbound calls are stored in `app_flow_dispatches` (Setup → Flows → Failed runs). |
| **CORS** | `credentials: true` with an explicit origin allowlist. `CORS_ORIGIN=*` is ignored (and **refused in production**) so browsers never get reflected arbitrary Origins. |
| **TLS & rate limiting** | Terminate **TLS** at the reverse proxy / load balancer in front of the BFF. Login uses per-IP and per-**IP+email** failure windows. Compose defaults `NODE_ENV=production` on BFF. Weak bootstrap passwords are refused always unless `ALLOW_INSECURE_BOOTSTRAP=true`. |
| **n8n automation user** | Any active app user JWT works for record APIs. Seed helper defaults to non-admin **Integration** (`--admin` opt-in). |

See also [`SECURITY.md`](SECURITY.md) for vulnerability reporting, [`SUPPORT.md`](SUPPORT.md) for the support model, [`docs/upgrading.md`](docs/upgrading.md) for upgrades, and [`docs/backup-restore.md`](docs/backup-restore.md) for backups.

### Tests / CI

Unit tests live next to source (`*.test.ts` under `crm-bff/src/` and `tests/`). CI is [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

```bash
npm test                      # Vitest app unit smoke tests
npm --prefix crm-bff test     # includes guard audit + field-security / owner RLS / leak tests
npm --prefix crm-bff run typecheck
npm run build                 # vue-tsc -b && vite build (what CI runs for the app)
npm run build:ci              # vite build only (skip typecheck)
```

GitHub Actions runs three jobs on `main` (and `workflow_dispatch`): BFF typecheck + tests, app unit tests, and Vue `npm run build` (`vue-tsc -b && vite build`). The BFF `npm test` job includes:

- **Guard audit** — `crm-bff/src/resolvers/resolverAccessPolicy.test.ts` classifies every GraphQL Query/Mutation root and asserts the matching access guard.
- **Field-leak / field-security tests** — `crm-bff/src/services/fieldSecurity.test.ts` (tier gates / redaction) plus related coverage such as `uniqueGroups.formatError.test.ts` (unique-violation responses must not echo Postgres `detail` values).
- **Owner row security** — `crm-bff/src/services/rowLevelSecurity.test.ts` (owner filter merge, assert helpers, View all / Modify all bypass).

CI swaps sibling `file:../docEngine` deps for in-repo stubs under `ci/stubs/` (Vue app and `crm-bff` `@docengine/pdf-renderer` / editor / engine) so installs and builds run without a DocEngine checkout. Those stubs return a fixed PDF/HTML buffer — **CI never tests a real render**. Vite only aliases `@docengine/field-date` to the sibling when that path exists.

`npm run build` is `vue-tsc -b && vite build` and is the CI app gate. Use `npm run build:ci` only when you need a Vite bundle without waiting on typecheck.

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
| `OIDC_SCOPES` / `OIDC_CHECK_ON_REFRESH` | Scopes default `openid profile email offline_access` when check-on-refresh is on; explicit `OIDC_SCOPES` is honored as-is. No IdP refresh token → failed userinfo does not revoke |
| `OIDC_TOKEN_ENCRYPTION_KEY` | Recommended in production — seals IdP tokens at rest. If unset, derived from `AUTH_JWT_SECRET` |
| `OIDC_JIT_PROVISION` / `OIDC_DEFAULT_ROLE_BACKEND_ID` / `OIDC_ALLOWED_EMAIL_DOMAINS` | Optional auto-create of unknown SSO emails into one CoreEngine role (default off; domains required when JIT is on) |
| `TRUST_PROXY` | Behind TLS-terminating proxy/nginx, set so `request.protocol` is `https` (e.g. `loopback,uniquelocal`); otherwise OIDC cookies lose `Secure` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase / PostgREST (optional registry REST) |
| `DIRECTUS_RUNTIME` | Must be `off` (legacy HTTP SDK refuse; GraphQL adapter is separate) |
| `SMTP_HOST` / `SMTP_FROM` | Optional BFF platform mail (invite, reset, failed-run alerts). Same `SMTP_FROM` can be passed into the n8n process as the Message outbox From address; record/document delivery still uses n8n SMTP credentials |
| `N8N_BASE_URL` | Origin of the n8n instance you run, for Setup → Flows `target=n8n` (e.g. `http://127.0.0.1:5678` from host BFF, `http://n8n:5678` in compose). Required for outbox dispatch |
| `N8N_WEBHOOK_SECRET` | Shared secret; BFF sends `X-CRM-Flow-Secret`, n8n templates check it (required in production when n8n is configured) |
| `N8N_ENCRYPTION_KEY` | Fixed n8n credential encryption key (compose requires it; persist with the n8n volume) |
| `FLOWS_HTTP_ALLOWED_HOSTS` | Hosts allowed for private/Docker HTTP flow targets (e.g. `localhost,127.0.0.1,n8n,n8n:5678`). Loopback to the configured n8n host is allowed outside production |
| `CRM_N8N_EMAIL` / `CRM_N8N_PASSWORD` | Non-admin Integration user from `npm run registry:seed-n8n-automation-user` (n8n → BFF login; Modify all on `message` only) |
| `FAILED_RUN_NOTIFY` / `FAILED_RUN_NOTIFY_EMAIL` | Optional email when a flow or scheduled task fails (also Setup → General). Needs SMTP. Email overrides admin-user recipients when set |
| `TASK_SCHEDULER_ENABLED` | In-process scheduled jobs inside this BFF. Default **on** (`false` / `0` / `off` disables). Set `false` on every extra instance; there is no lock that stops two processes from running the same job |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run bff:dev` | GraphQL BFF |
| `npm run build` | `vue-tsc -b && vite build` (CI app job) |
| `npm run build:ci` | `vite build` only (skip typecheck) |
| `npm run preview` | Preview production build |
| `npm run install:minimal` | One-shot lightweight Docker install (Windows PowerShell) |
| `npm run install:minimal:sh` | Same via bash (`./scripts/install-minimal.sh`) |
| `npm run registry:check-cutover` | Migration health gate |
| `npm run registry:migrate` | Apply platform kernel SQL (PowerShell + `psql`) — **existing DB upgrade** |
| `npm run registry:migrate:node` | Same kernel SQL via Node (`pg`); use this on Linux / in Docker |
| `npm run registry:smoke-upgrade` | Migrate twice (idempotent) + require `app_flow_dispatches` + `/health` |
| `npm run registry:smoke-backup-restore` | `pg_dump` archive check (+ scratch restore when the role can `CREATE DATABASE`) |
| `npm run registry:seed-n8n-pack-flows` | Seed pack flow keys + Message outbox automations/task (`--pack=sales`) |
| `npm run registry:seed-n8n-automation-user` | Create Integration user for n8n → BFF login |
| `npm run platform:provision` | **New** customer DB via Node (`--domain`, `--admin-password`) — Mac/Linux/Windows |
| `npm run platform:provision:ps1` | Same provision via PowerShell (`-Domain`, `-AdminPassword`) |
| `npm run platform:provision:node` | Alias of `platform:provision` |
| `npm run platform:apply-pack` | Apply a domain pack onto an existing kernel DB |
| `npm run platform:export-pack` | Save live Setup config back into `supabase/domains/<id>` |

## Layout types

Entity layout schemas live under `src/interfaces` / config layout services and are stored in registry `layout_settings` (served by the BFF).
