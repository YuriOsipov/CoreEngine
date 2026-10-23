# Helix platform database (kernel + domain packs)

Provision a **new Supabase / Postgres database** per customer, then optionally apply a domain starter pack.

## Layers

| Layer | Path | What it is |
|-------|------|------------|
| **Kernel** | `migrations/*.sql` | Platform tables + admin + reserved PLATFORM objects |
| **Domain pack** | `domains/<id>/` | Sales / Clinic starter entities, roles, layouts |
| **Customer** | Setup UI after login | Extra objects and configuration for that business |

```text
New DB  →  kernel  →  optional pack (sales|clinic|pricing)  →  customize in Helix
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

```powershell
# Kernel only
npm run platform:provision

# Kernel + Sales
npm run platform:provision -- -Domain sales

# Kernel + Clinic
npm run platform:provision -- -Domain clinic -AdminPassword 'ChangeMeNow!'

# Kernel + Pricing / promotions
npm run platform:provision -- -Domain pricing
```

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

- [`domains/sales`](domains/sales) — Account, Contact, Opportunity, Quote
- [`domains/clinic`](domains/clinic) — Patient, Practitioner, Visit, Appointment
- [`domains/pricing`](domains/pricing) — Item catalog, Campaign → Promotion, item prices (`promo_price` + linked promotion)

Add a new pack by copying a domain folder and registering it in `scripts/provision-platform-db.ps1` (`ValidateSet`).

## Notes

- Business tables live in `crm_schema.<api_name>` and are created by DDL sync when entities are created (pack loader and Setup).
- Kernel SQL is applied via `npm run registry:migrate` (same as `platform:provision` step 1).
- Never commit `supabase/.env`.
