# Security model

CoreEngine security is enforced by the **BFF** (GraphQL / REST / SOQL). The UI never stands alone — hiding a field or list filter in Setup does not replace API checks.

Vulnerability reporting: [`SECURITY.md`](../SECURITY.md). Support: [`SUPPORT.md`](../SUPPORT.md). Compliance expectations (audit, retention, encryption — **not** a certification): [`compliance-posture.md`](./compliance-posture.md).

## Layers

| Layer | Answers | Where you configure it | Enforced by |
|-------|---------|------------------------|-------------|
| **Authentication** | Who is signed in? | Local login and/or OIDC IdP | BFF JWT + optional IdP |
| **Object ACL** | May this role Create / Read / Update / Delete / Import / Export this object? | Setup → Roles | BFF `assertEntityPermission` |
| **Field sensitivity** | Which columns may this role see or edit? | Setup → Fields + Roles (Sensitive read/edit) | BFF FLS redaction / write deny |
| **Owner row security** | Which **rows** may this user reach? | Setup → Entity parameters + Roles View all / Modify all | BFF owner / read-share filters |
| **Layouts / nav** | What does the UI show? | Role Block / Record / list layouts, nav apps | UX only (on top of the layers above) |

## Common SMB patterns

| Goal | Configure |
|------|-----------|
| Rep sees only own Accounts / Opportunities | Owner row security **on** for those objects; Rep has Read/Update (no View all) |
| Manager sees everyone’s book / reassigns a leaver’s rows | Same objects; Manager gets **View all** + **Modify all**, then **Change Owner** **per record** (no bulk “move all of user A” UI yet; no cascade to children on parent reassignment) |
| Recipient can open Messages sent to them | Owner RLS on `message` + **Also grant read if** → `to_user` (Sales pack seeds this) |
| Peer queue (all Sales Reps read each other’s rows) | **Also grant read if same role as owner** on that object (coarser than future Teams) |
| Hide salary / cost from most roles | Mark field Restricted/Confidential; grant Sensitive read/edit only on trusted roles |
| SSO with IdP MFA | Enable OIDC; set `AUTH_LOCAL_LOGIN_ENABLED=false` so local password cannot bypass IdP MFA |

## Authentication

- BFF local login (`VITE_AUTH_MODE=bff`) issues verified Bearer access tokens (**15-minute** TTL) + refresh tokens (**30-day** TTL).
- Optional **OIDC SSO** (`OIDC_ENABLED`) — Authorization Code + PKCE against an external IdP (Keycloak, Auth0, Entra, …). See [`oidc-sso.md`](./oidc-sso.md).
- **Roles and admin flags stay in CoreEngine** (Setup → Users / Roles) — IdP groups/roles are not synced. MFA lives on the IdP.
- Local password login defaults **on**; set `AUTH_LOCAL_LOGIN_ENABLED=false` for SSO-only.
- Refresh-token **reuse** revokes all sessions for that user. Admin status comes from the **database**, not from JWT / IdP claims.
- Deactivate in Setup (`is_active = false`) for immediate API deny.

## Object-level ACL

- Per-role Create / Read / Update / Delete / Import / Export — **enforced by the BFF**. Without Read, the object is unreachable even if a layout or nav item points at it.
- Setup → Roles also grants optional **View all** / **Modify all** per object (only meaningful when owner row security is on).
- **Setup / registry** mutations require **admin** (`requireAdminAccess`). Successful changes append to **`config_audits`** (GraphQL `configAudits`) — entities, fields, roles, permissions, users, layouts, **automations**, **org settings**.

## Field-level security (sensitivity)

- Mark a field **None / Restricted / Confidential** in Setup → Fields; grant a per-role max **Sensitive read** / **Sensitive edit** tier in Setup → Roles. Platform default is open (new fields = None) until an admin marks them. Admins bypass. **UI hide alone is not enough**.
- **Entity / pack default:** Setup → Entity parameters → **Default field security level** (`backend_config.defaultFieldSensitivity`).
- **Column-level only.** Flags do **not** by themselves cover “Sales can see salary only for their own team” — combine with owner row security or keep that data on a separate object.
- **Covered (unit-tested):** record reads & writes; filters, sorts, aggregates (`assertReadableQuery` before every store); dotted SOQL keys; list search; revision snapshot redaction; export/import; upsert / unique-key lookups; `expand=children`; bulk update; unique-violation API text (no Postgres `detail`); formula/rollup inherit max source sensitivity (value field, **rollup child filters**, formula sources); live rollup omit on filter FLS deny; child value lookup filter/value FLS; ddlSync sensitivity column comments; production boot refuses missing sensitivity columns; hard delete audits **before** erase; GraphQL strips / admin-gates automation rules; presets/dashboards/panels list visibility.
- **Documents vs FLS:** `generateDocument` freezes the generating caller’s readable snapshot. Persisted `doc_value` / PDF/HTML then follows **document-object ACL**. See [`generate-document-api.md`](./generate-document-api.md).
## Owner row security (record-level)

- Opt-in per object so users without View/Modify all only reach rows they **own** (`owner_id`). Kernel default is **off**. The **Sales pack** turns it **on** for `account`, `contact`, `opportunity`, `message`, and `opportunity_item`.
- **Enable:** Setup → Entity parameters → **Owner row security**, or `backendConfig.rowLevelSecurity = "owner"` in pack JSON.
- Optional **Inherit owner from parent** (`backendConfig.inheritOwnerFrom`) copies parent `owner_id` on create after the caller can **read** that parent (owner RLS / View all). The parent FK is **immutable on update**. **Created By** (`user_created`) stays the creating actor.
- **Change Owner:** record action + `updateRecord` with `owner_id` (one row). Allowed for **Modify all** / admin / system, and for the **current owner**. The new id must be an **active** `app_users` row (`is_active`, `backend_user_id` or id); typos and deactivated users are rejected. Unauthorized reassignment returns **Permission denied** (it is not dropped). Activity/revision audit includes the new `owner_id`. **`inheritOwnerFrom` copies parent owner on create only** — changing a parent’s owner does **not** cascade to existing children. There is **no** bulk “reassign all of user A’s records” list/admin action yet; for a leaver, reassign each row (or script `updateRecord` / MCP) before or after deactivating the user. Managers with Modify all are not limited to “edit others’ fields while leaving ownership stranded.”
- **Also grant read if** (`rowLevelReadAlsoIf`): UUID/M2O → Users fields (e.g. Message `to_user`). Matching users may **read**; update/delete stay owner-only.
- **Also grant read if same role as owner** (`rowLevelReadAlsoIfSameRole`): peers with the owner’s app Role may **read**. Coarser than a future Teams object.
- **Typical setup:** Reps = Read/Update (owner filter). Managers = same CRUD **plus View all** (and **Modify all** if needed). Platform admins bypass.
- **Enforced:** list, get-by-id, update, soft-delete, restore, aggregates, live rollups, M2O list search (Supabase/Hasura), file read/write on parent records, generateDocument source access. Directus applies owner filters on the queried object itself; nested/dotted filters that hop through an owner-secured related object are **refused** (Directus cannot AND a related-row owner predicate the way Supabase/Hasura M2O search can).
- **Bypass:** admins; `SYSTEM_RECORD_ACCESS`; role **View all** / **Modify all** (still need Read / Update / Delete).
- **Not yet:** Teams / membership subsets, manual share UI, role hierarchy, criteria sharing rules, or **bulk** Change Owner from the list. Role list filters/views are UX-only. Directus has no related-row owner filter implementation (fail closed instead).
- **n8n / Activepieces / automation:** any active app user JWT works for record APIs. Seed helper defaults to non-admin **Integration**. With owner RLS on, creates stamp `owner_id` to that user.
- **Tests:** `crm-bff/src/services/rowLevelSecurity.test.ts`, `fieldSecurity.test.ts`, `resolverAccessPolicy.test.ts`.

## Layouts, preview, and UX

- **Admin “View as role”** — `X-Role-Preview` applies the selected role’s object ACL, FLS, and owner rules without logging out. Setup mutations and GraphQL `me` keep real admin identity; audits still stamp the admin.
- Per-role layouts, list filters/views, and navigation apps are UX on top of API security — they do not grant access by themselves.

## Accepted product limits

No open high-priority FLS/ACL gaps. Buyer notes:

- **Record automations** — Setup → Automations are **trusted server policy** (like formulas/rollups). create/update/delete/open `setFields` apply after the caller passes object Update + owner RLS; caller FLS does not block automation keys. **`notify`** is toast-only. Automation definition changes go to `config_audits`.
- **FLS cache** — Setup field/role writes call `clearFieldSecurityCache()` (DB epoch); peers reload on next request. In-memory TTL is a fallback only.
- **Owner RLS “Not yet”** — Teams / membership subsets, manual share UI, role hierarchy, criteria sharing, bulk Change Owner (see Owner row security above). Directus related-row owner filters are fail-closed, not implemented.

Keep Confidential data on objects with tight object ACL / owner RLS. Config history: GraphQL `configAudits` or DB `public.config_audits`.

## Deployment checklist

| Topic | Behavior |
|-------|----------|
| **JWTs** | HMAC-signed, algorithm-pinned, verified on each guarded request. Access TTL **15 minutes**; refresh rotates. Reuse of a rotated refresh token revokes **all** sessions. Placeholder / too-short `AUTH_JWT_SECRET` refused at every BFF start. |
| **OIDC SSO** | Optional external IdP. Discovery endpoints must share the issuer (or `OIDC_INTERNAL_ISSUER`) origin. IdP **429/5xx** → refresh **503**, no revoke/deactivate. Real IdP reject may revoke sessions; `OIDC_DEACTIVATE_ON_IDP_REJECT` never deactivates admins. JIT default role must be non-admin. See [`oidc-sso.md`](./oidc-sso.md). |
| **Admin status** | From the **database**, not JWT / IdP claims. |
| **Setup mutations** | Require **admin**. Config changes → `config_audits` / `configAudits` query (includes automations + org settings). BFF start + `registry:check-cutover` refuse missing append-only triggers (`config_audits_append_only` / `_truncate`) — migrate can NOTICE-skip them when the role does not own the table. |
| **Automation rules** | Admin-only schema read; create/update/delete/open `setFields` are trusted server policy (caller needs Update + owner RLS). JWT flow patches are FLS-checked. |
| **Presets / dashboards** | Non-admins see global + own-user / own-role presets; dashboards/panels scoped like layoutSettings (`role_id` null or matching role). |
| **Object ACL** | Per-role CRUD matrix. Missing Read blocks the object on API paths. |
| **Field tiers** | Sensitivity `0` / `1` / `2` + per-role max read/edit. Production refuses to start if sensitivity columns are missing. |
| **Owner row security** | Opt-in `owner_id` + optional read-share / same-role read. Managers: View all / Modify all. No Teams object yet. |
| **Document render** | Worker thread + hard kill on timeout; V8 heap/stack `resourceLimits`; `DOC_RENDER_*` caps. Uses published `@docengine/pdf-renderer` (real PDF smoke lives in the DocEngine package / local `crm-bff` `npm run test:docengine-render`). |
| **Hasura / Directus** | Optional record backends — keep admin consoles / secrets off public networks. Clients talk to the BFF only. Directus: nested/dotted filters through owner-secured related objects are refused (no related-row owner filter). Prefer Supabase/Hasura when owner RLS + relation filters are required. |
| **Scheduler** | In-process with **Postgres advisory locks** per task + Message **SKIP LOCKED** claim. Prefer **one** BFF with `TASK_SCHEDULER_ENABLED=true`; disable on replicas. Durable multi-instance queue (pg-boss / Graphile Worker) is planned. |
| **External Flows** | Setup → External Flows (`app_flow_triggers`). Outbound HTTP uses SSRF guards + `FLOWS_HTTP_ALLOWED_HOSTS` (and configured n8n/Activepieces bases) for private targets; loopback hard-blocked in production unless explicitly allowed. Custom-URL auth secrets are AES-GCM sealed at rest (`FLOWS_SECRET_ENCRYPTION_KEY` or derived from `AUTH_JWT_SECRET`); admin list redacts them. Failed-run / notify text strips absolute URLs and credential-like substrings. Shared n8n/Activepieces webhook secrets stay in env, not in trigger rows. `FLOWS_TRIGGER_REQUIRE_AUTH=false` refused in production. |
| **CORS** | Explicit origin allowlist; `CORS_ORIGIN=*` ignored / refused in production. |
| **TLS & rate limiting** | Terminate TLS at the reverse proxy. Login uses per-IP and per-IP+email failure windows. |
| **Bootstrap** | Weak bootstrap admin passwords refused unless `ALLOW_INSECURE_BOOTSTRAP=true`. |
| **n8n / Activepieces automation user** | Any active app user JWT; seed helper defaults to non-admin Integration. |
| **MCP (`/api/v1/mcp`)** | Off unless `MCP_HTTP_ENABLED=true`. Bearer CoreEngine JWT only (SSO-only: copy token after UI OIDC session — see [`mcp.md`](./mcp.md)). Admin tools → `requireAdminAccess`; schema/layout writes need `MCP_SCHEMA_WRITE_ENABLED=true` (default off). Record tools → same facade FLS/RLS as GraphQL. Per-user rate limit + `query_records` row cap. `inspect_flow_logs` admin-only, omits request bodies. `confirm: true` is **not** human approval. Audits use `MCP …` / `mcp:…` comments. |
