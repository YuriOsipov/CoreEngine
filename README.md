# CoreEngine — schema-driven, backend-agnostic development platform

Build internal tools, custom business apps, and operational systems from metadata—without hand-coding CRUD screens (Vue 3 + TypeScript + GraphQL BFF).

CoreEngine separates your **Control Plane** (schema registry, role-scoped layouts, automations, and document templates on Supabase/Postgres) from your **Data Plane** (Postgres/Supabase, Hasura, Directus, or any GraphQL backend). Define your objects, relations, and UI layouts once in Setup, and CoreEngine dynamically renders forms, tree/list views, resource schedulers, projects, and pixel-perfect PDF/HTML documents (`@docengine/*`).

### Core capabilities

- **Schema-driven UI:** Object Manager, role-scoped edit/view forms, tree navigation + master-detail, conditional field/block rules, inline editing, and barcode scanning.
- **Backend-agnostic BFF:** Unified GraphQL & REST layer decoupling your UI configurations from underlying data providers.
- **Built-in operational modules:** Resource scheduling, Kanban/Gantt projects, tiered/campaign pricing engines, and scheduled background tasks.
- **Pixel-perfect documents:** Visual HTML/PDF template builder (`DocEngine`) with recursive tree mapping.
- **Git-versioned domain packs:** Ship and version full vertical configurations as code (see [`docs/domain-packs.md`](docs/domain-packs.md) for starter packs including **Sales**, **Pricing**, **Clinic**, and **Documents**).

**License:** MIT ([`LICENSE`](LICENSE)). Other components: [`THIRD_PARTY.md`](THIRD_PARTY.md). Support: [`SUPPORT.md`](SUPPORT.md) (community, no SLA). Vulnerabilities: [`SECURITY.md`](SECURITY.md).

**Project status:** early-stage, aimed at **SMB / mid-market** (tens to a few hundred users). No sharing hierarchies, **no SAML/SCIM**, no AppExchange-depth automation, **no built-in durable workflow queue**. Owner row security + View/Modify all + **Change Owner** (per record; **no** bulk leaver transfer or child-owner cascade yet) cover “my rows / manager sees all”; multi-step retries live in **Activepieces (MIT)**, **n8n**, or a custom webhook via Setup → External Flows. Platform Setup → Tasks uses a **Postgres advisory lock** per job; Message outbox claims rows with **`FOR UPDATE SKIP LOCKED`** (see [`docs/features.md`](docs/features.md) — stock send templates can still double-deliver on crash-before-Mark-sent). Interactive DocEngine comes from npm `@docengine/*` — see below.

**For:** developers and architects building schema-driven internal tools; implementers who want Setup + packs + documents, with optional engineer-owned blocks.

**Not trying to be:** Twenty-style SDK CRM, Retool canvases, inbox/calendar CRM, full ERP accounting (see Frappe note), enterprise sharing hierarchies / SAML/SCIM, in-product AI agents, or a mature multi-tenant SaaS community yet.

### Quick comparison

*As of November 2026. Competitor SSO, AI, and packaging change often — re-check before relying on a cell.*

| Need | CoreEngine | NocoBase | Twenty | Retool | Salesforce |
|------|------------|----------|--------|--------|------------|
| Custom objects + relationships | Strong | Excellent | Strong | Query existing data | Excellent |
| Role layouts, list filters, object CRUD, field-level tiers | Strong (UX + BFF); owner RLS + View/Modify all; no manual share yet | Strong | Strong object ACL | Build separate UIs | Excellent |
| Owner / row-level access | Opt-in owner RLS + View/Modify all + per-record Change Owner (bulk leaver reassign / cascade still open) | Record / sharing rules | Org plan: row-level; free self-host: field-level roles | App logic | Sharing rules / teams / hierarchy |
| SSO (OIDC) / MFA | OIDC via external IdP; MFA on IdP; no SAML/SCIM | Auth plugins / IdP | OIDC/SAML SSO on **Organization** plan (cloud *and* self-hosted) | Product-dependent | Full |
| CRM pipeline | Sales starter pack | Build / plugins | Strong | Build it | Excellent |
| Campaign → promo pricing | Built-in | Build it | Custom objects | Build it | Custom / AppExchange |
| Resource scheduling | Built-in | Plugins / build | Limited | Build it | Service Cloud / custom |
| Projects (board / Gantt) | Built-in | Plugins / build | Limited | Build it | Custom / AppExchange |
| Document generation (PDF/HTML) | UI DocEngine + server generate (pinned `@docengine/*`; PDF smoke in DocEngine CI) | Plugins / build | Limited | Build it | Good |
| Durable multi-step workflows | No in-app queue — **[Activepieces](https://www.activepieces.com/)** (**MIT**), **n8n** (Sustainable Use), or custom webhook via Setup → External Flows. Tasks: advisory lock; Message claim: `SKIP LOCKED` (reclaim can still double-send with stock templates) | Built-in | Built-in + AI | Built-in | Flow + Apex |
| AI / MCP assistants | Opt-in BFF **MCP** for schema/packs/records ([`docs/mcp.md`](docs/mcp.md)); **no** in-product AI agents — use external agents against GraphQL/REST/MCP | Built-in MCP server + AI Employees plugins | In-product AI agents | Retool AI | Agentforce (Einstein brand still on some predictive features) |
| Config as code (packs in git) | Yes | Partial | Yes (SDK) | App source | Metadata / DX |
| Community / product maturity | Early-stage | Established OSS | Growing OSS CRM | Mature commercial | Mature enterprise |
| Price | Free / self-hosted (MIT) | Free Core / commercial | Free self-host core; Org license for SSO / row ACL | Paid | Expensive |

**Also consider [Frappe](https://frappe.io/) / [ERPNext](https://frappe.io/erpnext):** closest architectural peer (DocTypes, role/field permissions, Print Formats, approval workflows). Stronger on ERP accounting and in-app workflow; heavier than CoreEngine’s ops + domain-pack focus. Not a cell-by-cell column here — compare when the alternative is a full ERP stack rather than CRM/low-code builders.

---

## Quick start

Lightweight Postgres + BFF ([`docker-compose.minimal.yml`](docker-compose.minimal.yml)):

```bash
# Windows (PowerShell):
npm run install:minimal

# macOS / Linux:
chmod +x ./scripts/install-minimal.sh
./scripts/install-minimal.sh --domain sales --with-ui
```

**What `--domain sales` ships:** platform kernel + Documents pack (Document Templates objects, empty of sample templates) + Sales pack schema, roles (**Sales Rep** / **Sales Manager** / **Pricing Manager**), layouts, and demo data — accounts & contacts, opportunities (with line items), catalog (item groups / items / price groups / item prices), a sample campaign with promotions, and a few inbox messages. No quote rows in the seed. Use `--domain none` for kernel + Documents only.

- BFF: http://localhost:4000/health — UI (with `--with-ui`): http://localhost:8080  
- Login: `admin@example.com` (password printed by provision)

Full Supabase stack, local npm, env vars, and scripts: [`docs/setup.md`](docs/setup.md).

---

## Vertical domain packs

Starter packs under `supabase/domains/` are **optional configurations**, not the identity of the platform. They adapt the same kernel to an industry (entities, roles, layouts, seed data). Included: **sales**, **clinic**, **pricing**; **documents** is always applied on provision.

What each starter includes, compliance posture for Clinic/Pricing, vertical matrix, apply/export, and how to build your own: [`docs/domain-packs.md`](docs/domain-packs.md). Runbooks: [`supabase/README.md`](supabase/README.md).

---

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/features.md`](docs/features.md) | Capability overview, builders, automation, documents, packs |
| [`docs/fields-and-search.md`](docs/fields-and-search.md) | String vs Text lengths; Indexed vs full-text (GIN) list search |
| [`docs/domain-packs.md`](docs/domain-packs.md) | Vertical packs matrix, apply/export, building your own |
| [`docs/security.md`](docs/security.md) | Auth, object ACL, field sensitivity, owner RLS, Change Owner, deployment checklist |
| [`docs/compliance-posture.md`](docs/compliance-posture.md) | Audit / retention / encryption expectations — **not** a GDPR/HIPAA certification |
| [`docs/setup.md`](docs/setup.md) | Docker / local install, environment, scripts, CI |
| [`docs/oidc-sso.md`](docs/oidc-sso.md) | External OIDC IdP (Keycloak, Auth0, Entra, …) |
| [`docs/n8n/README.md`](docs/n8n/README.md) | n8n profile, pack flows, Message outbox templates |
| [`docs/activepieces/README.md`](docs/activepieces/README.md) | Activepieces (MIT) — minimal Compose (`restart: always`); headless seed `registry:seed-activepieces-flows` (CE JWT + project variables; no Platform API keys) |
| [`docs/n8n-bff-flows.md`](docs/n8n-bff-flows.md) | Setup → External Flows + GraphQL write-back (n8n / Activepieces) |
| [`docs/mcp.md`](docs/mcp.md) | Opt-in BFF MCP server for schema, packs, and records |
| [`docs/upgrading.md`](docs/upgrading.md) | Pull → migrate → rebuild |
| [`docs/backup-restore.md`](docs/backup-restore.md) | Postgres dump / restore |
| [`docs/generate-document-api.md`](docs/generate-document-api.md) | Automation `generateDocument` |
| [`docs/custom-blocks.md`](docs/custom-blocks.md) | `registerCustomBlock` extensions |
| [`supabase/README.md`](supabase/README.md) | Platform kernel + domain packs |
| [`supabase/domains/sales/README.md`](supabase/domains/sales/README.md) | Sales pack (CRM + messaging) |
| [`crm-bff/README.md`](crm-bff/README.md) | GraphQL / REST BFF |

**DocEngine** (interactive HTML/PDF) ships as npm packages `@docengine/editor`, `@docengine/engine`, `@docengine/pdf-renderer`, `@docengine/field-date` at **0.0.107** (MIT source: [YuriiOsypov/docEngine](https://github.com/YuriiOsypov/docEngine)). Links: [editor](https://www.npmjs.com/package/@docengine/editor) · [engine](https://www.npmjs.com/package/@docengine/engine) · [pdf-renderer](https://www.npmjs.com/package/@docengine/pdf-renderer) · [field-date](https://www.npmjs.com/package/@docengine/field-date). CoreEngine CI covers **no `file:` pins** (`npm run assert:no-file-deps`), BFF / app unit tests, and `npm run build` with **`npm ci`** (lockfile enforced). Real PDF smoke lives in the DocEngine package (or locally: `crm-bff` `npm run test:docengine-render`). Stubs under `ci/stubs/` are **opt-in only** (`workflow_dispatch` → Use DocEngine stubs, or `DOCENGINE_ALLOW_STUBS=true`); a missing pin or registry blip fails the job instead of silently stubbing. Maintainers iterating on DocEngine next to this repo: `npm run docengine:use-local` (sibling `../docEngine`), then `npm run docengine:use-npm` before committing. Publish checklist: [docEngine/docs/PUBLISH.md](https://github.com/YuriiOsypov/docEngine/blob/main/docs/PUBLISH.md).

**External Flows** (Setup → External Flows): outbound HTTP to n8n / Activepieces / custom webhooks with host allowlisting (`FLOWS_HTTP_ALLOWED_HOSTS`), AES-GCM sealed custom-URL auth secrets, and URL/token redaction in failed-run records — see [`docs/security.md`](docs/security.md).
