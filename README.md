# CoreEngine — operations suite for service and sales teams

Self-hosted ops app for teams that need **role-scoped layouts**, **tree price lists / campaign pricing**, **in-app documents** (HTML/PDF), **resource scheduling + projects**, and **git-versioned domain packs** — on a schema-driven object model with a GraphQL BFF.

Vue 3 + Vite + TypeScript. Registry on Supabase; vertical starters (Sales, Clinic, Pricing, Documents).

**License:** MIT ([`LICENSE`](LICENSE)). Other components: [`THIRD_PARTY.md`](THIRD_PARTY.md). Support: [`SUPPORT.md`](SUPPORT.md) (community, no SLA). Vulnerabilities: [`SECURITY.md`](SECURITY.md).

**Project status:** early-stage, aimed at **SMB / mid-market** (tens to a few hundred users). No sharing hierarchies, **no SAML/SCIM**, no AppExchange-depth automation. Owner row security + View/Modify all + **Change Owner** cover “my rows / manager sees all / reassign leavers”; durable multi-step runs go to **n8n** (or a future Postgres queue). Interactive DocEngine comes from npm `@docengine/*` — see below.

**For:** operators and vertical implementers who want Setup + packs + documents, with optional engineer-owned blocks — not Twenty-style SDK CRM, Retool canvases, inbox/calendar CRM, or full ERP accounting (see Frappe note below).

### Quick comparison

*As of November 2026. Competitor SSO, AI, and packaging change often — re-check before relying on a cell.*

| Need | CoreEngine | NocoBase | Twenty | Retool | Salesforce |
|------|------------|----------|--------|--------|------------|
| Custom objects + relationships | Strong | Excellent | Strong | Query existing data | Excellent |
| Role layouts, list filters, object CRUD, field-level tiers | Strong (UX + BFF); owner RLS + View/Modify all; no manual share yet | Strong | Strong object ACL | Build separate UIs | Excellent |
| Owner / row-level access | Opt-in owner RLS + View/Modify all + Change Owner | Record / sharing rules | Org plan: row-level; free self-host: field-level roles | App logic | Sharing rules / teams / hierarchy |
| SSO (OIDC) / MFA | OIDC via external IdP; MFA on IdP; no SAML/SCIM | Auth plugins / IdP | OIDC/SAML SSO on **Organization** plan (cloud *and* self-hosted) | Product-dependent | Full |
| CRM pipeline | Sales starter pack | Build / plugins | Strong | Build it | Excellent |
| Campaign → promo pricing | Built-in | Build it | Custom objects | Build it | Custom / AppExchange |
| Resource scheduling | Built-in | Plugins / build | Limited | Build it | Service Cloud / custom |
| Projects (board / Gantt) | Built-in | Plugins / build | Limited | Build it | Custom / AppExchange |
| Document generation (PDF/HTML) | UI DocEngine + server generate (CI real-PDF job) | Plugins / build | Limited | Build it | Good |
| Durable multi-step workflows | Via **n8n** (license limits hosting/resale) | Built-in | Built-in + AI | Built-in | Flow + Apex |
| Config as code (packs in git) | Yes | Partial | Yes (SDK) | App source | Metadata / DX |
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

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/features.md`](docs/features.md) | Capability overview, builders, automation, documents, packs |
| [`docs/security.md`](docs/security.md) | Auth, object ACL, field sensitivity, owner RLS, Change Owner, deployment checklist |
| [`docs/setup.md`](docs/setup.md) | Docker / local install, environment, scripts, CI |
| [`docs/oidc-sso.md`](docs/oidc-sso.md) | External OIDC IdP (Keycloak, Auth0, Entra, …) |
| [`docs/n8n/README.md`](docs/n8n/README.md) | n8n profile, pack flows, Message outbox templates |
| [`docs/n8n-bff-flows.md`](docs/n8n-bff-flows.md) | Webhook trigger + GraphQL write-back |
| [`docs/upgrading.md`](docs/upgrading.md) | Pull → migrate → rebuild |
| [`docs/backup-restore.md`](docs/backup-restore.md) | Postgres dump / restore |
| [`docs/generate-document-api.md`](docs/generate-document-api.md) | Automation `generateDocument` |
| [`docs/custom-blocks.md`](docs/custom-blocks.md) | `registerCustomBlock` extensions |
| [`supabase/README.md`](supabase/README.md) | Platform kernel + domain packs |
| [`supabase/domains/sales/README.md`](supabase/domains/sales/README.md) | Sales pack (CRM + messaging) |
| [`crm-bff/README.md`](crm-bff/README.md) | GraphQL / REST BFF |

**DocEngine** (interactive HTML/PDF) ships as npm packages `@docengine/editor`, `@docengine/engine`, `@docengine/pdf-renderer`, `@docengine/field-date` at **0.0.105** (MIT source: [YuriiOsypov/docEngine](https://github.com/YuriiOsypov/docEngine)). Links: [editor](https://www.npmjs.com/package/@docengine/editor) · [engine](https://www.npmjs.com/package/@docengine/engine) · [pdf-renderer](https://www.npmjs.com/package/@docengine/pdf-renderer) · [field-date](https://www.npmjs.com/package/@docengine/field-date). CI’s **DocEngine real PDF render** job renders PDF and HTML from published `@docengine/*@0.0.105` (`crm-bff` `npm run test:docengine-render`). The app build job runs `npm run build` (`vue-tsc -b && vite build`). If that pin is missing from the registry, the fast jobs fall back to `ci/stubs/` and the render job checks out the sibling repo. Maintainers iterating on DocEngine next to this repo: `npm run docengine:use-local` (sibling `../docEngine`), then `npm run docengine:use-npm` before committing. Publish checklist: [docEngine/docs/PUBLISH.md](https://github.com/YuriiOsypov/docEngine/blob/main/docs/PUBLISH.md).
