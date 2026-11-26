# Vertical domain packs

CoreEngine uses Git-versioned **domain packs** so the same lightweight kernel adapts to different industries without forking the Vue / GraphQL codebase.

A pack is additive registry seed data under [`supabase/domains/<id>/`](../supabase/domains/): entities, roles, layouts, navigation, optional seed records, and related n8n / Connection keys. Business tables are created in `crm_schema` by DDL sync when objects are applied — vertical vocabulary stays out of the kernel SQL in `supabase/migrations/`.

```text
New customer DB  →  kernel  →  documents (always)  →  optional vertical pack  →  customize in Setup
```

Operational runbooks (provision, apply, export): [`../supabase/README.md`](../supabase/README.md). Install flags: [`setup.md`](./setup.md).

---

## Shipped packs

| Pack id | Apply | What you get |
|---------|-------|--------------|
| **`documents`** | Always on provision | Document Templates objects (`doc_template`, snapshots) for Setup → Document Templates |
| **`sales`** | `--domain sales` | Accounts, Contacts, Opportunities (+ line items / messaging in commercial seed), roles **Sales Rep**, **Sales Manager**, **Pricing Manager** |
| **`pricing`** | Often with Sales / `--domain pricing` | Item groups, items, price groups, campaigns → promotions, promo price sync |
| **`clinic`** | `--domain clinic` | Patients, Practitioners, Visits, Appointments; roles **Clinician**, **Reception** |

Per-pack detail: [`sales`](../supabase/domains/sales/README.md) · [`pricing`](../supabase/domains/pricing/README.md) · [`clinic`](../supabase/domains/clinic/README.md) · [`documents`](../supabase/domains/documents/README.md).

---

## Vertical matrix

Status legend: **Shipped** = pack folder + provision allow-list today. **Example / roadmap** = industry shape you can model by forking a shipped pack — not a first-class `--domain` id yet.

| Domain / vertical | Status | Core objects & roles | Scheduling & projects | Pricing & DocEngine PDFs |
| :--- | :--- | :--- | :--- | :--- |
| **Sales & B2B commerce** | **Shipped** (`sales` + `pricing` + `documents`) | Accounts, Contacts, Opportunities, Line Items; *Sales Rep, Sales Manager, Pricing Manager* | Onboarding / delivery boards via platform Projects | Hierarchical catalogs, campaign promo pricing, Quote / list PDFs |
| **Clinics & appointments** | **Shipped starter** (`clinic`) | Patients, Practitioners, Visits, Appointments; *Clinician, Reception* | Appointment calendars; reminder Connection → n8n | Extend with Pricing pack + Document Templates for reports / consents |
| **Labs, spas & multi-resource care** | Example / roadmap | Patients/clients, practitioners, rooms, lab tests & results | Multi-resource booking (staff + room); multi-visit care plans | Service/panel price lists, package credits, consent & lab report PDFs |
| **Real estate agencies** | Example / roadmap | Properties, listings, buyers/tenants, landlords, viewings | Agent viewing calendars, inspection schedules, closing checklists | Commission / fee tiers, promo listing packages, Offer & Lease PDFs |
| **Insurance & advisory** | Example / roadmap | Policyholders, policies, claims, underwriters, agents (PII field sensitivity) | Adjuster appointment slots; claim investigation projects | Tiered coverage/premium tables, Policy Schedules & Settlement PDFs |

---

## Apply & export

```bash
# New DB: kernel + documents + vertical
npm run platform:provision -- --domain sales
npm run platform:provision -- --domain clinic
npm run platform:provision -- --domain none   # kernel + documents only

# Existing kernel DB
npm run platform:apply-pack -- sales

# After editing Setup on a domain DB, write back to git
npm run platform:export-pack -- sales
```

Windows: `npm run platform:provision:ps1 -- -Domain sales`. Minimal Docker install: `./scripts/install-minimal.sh --domain sales --with-ui` (see [`setup.md`](./setup.md)).

Outbound automation destinations for pack webhook keys are configured under **Setup → Connections** (not raw URLs in Automations). See [`n8n-bff-flows.md`](./n8n-bff-flows.md).

---

## Building your own pack

1. Copy an existing folder under `supabase/domains/` (e.g. `clinic` or `sales`).
2. Edit `pack.json`, `entities.json`, `roles.json`, `layouts.json`, navigation, and optional `records.json`.
3. Register the pack id in the provision allow-lists (`scripts/provision-platform-db.mts` / `.ps1`).
4. Provision or `platform:apply-pack` onto a clean customer database.
5. Iterate in Setup (or via MCP `upsert_object_schema` / `export_domain_pack` — see [`mcp.md`](./mcp.md)), then `platform:export-pack` and commit.

Do **not** hand-write vertical `CREATE TABLE` into kernel migrations. Keep industry vocabulary in the pack (or customer Setup), so other customers stay on a shared kernel.

Custom Vue blocks for a vertical UI: [`custom-blocks.md`](./custom-blocks.md) (`registerCustomBlock`) — packs still choose *where* those blocks appear in layouts.
