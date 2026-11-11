# CoreEngine platform database (kernel + domain packs)

Provision a **new Supabase / Postgres database** per customer, then optionally apply a domain starter pack. The CoreEngine BFF (`crm-bff`) serves GraphQL plus an n8n-friendly REST surface (`/api/v1/…`, SOQL-style `/api/v1/query`, document generate) over the same registry and `crm_schema` tables created here.

## Layers

| Layer | Path | What it is |
|-------|------|------------|
| **Kernel** | `migrations/*.sql` | Platform tables + admin + reserved PLATFORM objects |
| **Domain pack** | `domains/<id>/` | Sales / Clinic / Pricing / Documents starter entities, roles, layouts |
| **Customer** | Setup UI after login | Extra objects and configuration for that business |

```text
New DB  →  kernel  →  optional pack (sales|clinic|pricing) + documents  →  customize in CoreEngine
```

## New customer runbook

1. Create an empty Postgres database (local Supabase or cloud project).
2. Copy env files:

```bash
cp supabase/.env.example supabase/.env
cp .env.example .env
# Edit supabase/.env to point at the new DB
```

3. Provision:

```bash
# Kernel only
npm run platform:provision -- --domain none

# Kernel + Sales
npm run platform:provision -- --domain sales

# Kernel + Clinic (first login forces a password change)
npm run platform:provision -- --domain clinic --admin-password 'ChooseAUniqueSecret!'

# Kernel + Pricing / promotions
npm run platform:provision -- --domain pricing
```

Windows PowerShell alternative: `npm run platform:provision:ps1 -- -Domain sales`.

4. Start the app:

```bash
npm run bff:dev
npm run dev
```

5. Sign in as `admin@example.com` (password from provision), then extend objects in Setup.

## Apply a pack later

```powershell
npm run platform:apply-pack -- sales
```

## Save Setup changes back into a pack

After editing fields / layouts / doc-template records in the UI on a domain DB:

```powershell
npm run platform:export-pack -- sales
```

This overwrites `supabase/domains/<id>/` (`entities.json`, `layouts.json`, `roles.json`, `records.json`) from the live registry. Commit those files so the next customer provision gets the same baseline.

## Domain packs

- [`domains/sales`](domains/sales) — **CoreEngine Sales** commercial starter: Account, Contact, Opportunity (stage Path), Quote; pairs with Pricing for catalog/promotions. Documents REST/SOQL/CRUD examples for these entities: see pack README **REST API (BFF)**.
- [`domains/clinic`](domains/clinic) — Patient, Practitioner, Visit, Appointment
- [`domains/pricing`](domains/pricing) — Item catalog, Campaign → Promotion, item prices (`promo_price` + linked promotion)
- [`domains/documents`](domains/documents) — Always applied on provision (`doc_template` / snapshots) for Setup → Document Templates

Add a new pack by copying a domain folder and registering it in `scripts/provision-platform-db.mts` / `.ps1` allow-lists.

## Integrations (BFF REST)

Pack entities are addressable via Bearer JWT after `POST /auth/login` (automation user: `npm run registry:seed-n8n-automation-user`):

| Surface | Path | Notes |
|---------|------|--------|
| SOQL subset | `GET`/`POST /api/v1/query` | `q=SELECT … FROM Opportunity …` (compiled to `findMany`, not raw SQL) |
| CRUD | `/api/v1/:collection[/:id]` | List/create/upsert/update/delete; `:id` may be PK or `uniqueField:value` |
| Expand children | `GET /api/v1/:collection/:id?expand=children` | One-shot parent + reverse-M2O children in `_children` (e.g. Opportunity → quotes) and linked `_files`; optional `childLimit`, `nofiles` |
| Documents | `POST /api/v1/documents/generate` | Phase 0 stub (HTTP 501). In-app DocEngine is separate; this route does not render a file |

Sales-oriented examples live in [`domains/sales/README.md`](domains/sales/README.md). Platform runbooks: [`docs/n8n-bff-flows.md`](../docs/n8n-bff-flows.md), [`docs/generate-document-api.md`](../docs/generate-document-api.md), [`crm-bff/README.md`](../crm-bff/README.md).

## Notes

- Business tables live in `crm_schema.<api_name>` and are created by DDL sync when entities are created (pack loader and Setup).
- Kernel SQL is applied via `npm run registry:migrate` (same as `platform:provision` step 1).
- Documents pack is applied during provision even when `-Domain` is `none` / another vertical.
- Never commit `supabase/.env`.
