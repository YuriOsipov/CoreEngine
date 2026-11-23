# CoreEngine Sales (commercial starter)

CoreEngine Sales is the commercial configuration for CRM pipeline work plus catalog pricing and campaign-driven promotions. It is applied as two domain packs on the CoreEngine kernel: **Sales portal** (`sales`) for accounts and deals, and **Pricing & promotions** (`pricing`) for catalog, price lists, campaigns, and promo prices. Shared platform capabilities (record Path, dynamic/lazy object lists, list barcode scan, Tree layouts, DocEngine list reports, scheduled promo sync) power the seeded objects once layouts/jobs are configured in Setup.

See also: [`../pricing/README.md`](../pricing/README.md).

---

## Sales portal pack (`sales`)

**Purpose:** Minimum sales portal — company, people, pipeline deals, and quote headers.

### Includes

| Entity | Purpose | Key fields |
|--------|---------|------------|
| `account` | Company / customer | industry, website, phone; display `{{name}}` |
| `contact` | People linked to accounts | email, phone, M2O `account_id` → Account |
| `opportunity` | Pipeline deal | amount, close_date, stage, outcome, M2O `account_id` |
| `quote` | Quote header on a deal | total, valid_until, M2O `opportunity_id` → Opportunity |

### Opportunity stages / outcomes

- Open stages: Prospecting → Qualified → Proposal (default Prospecting).
- Closed outcomes: Won / Lost / Cancelled.

### Layouts

- Form + list for Account, Contact, Opportunity, Quote.
- Opportunity **Record Page** (`groupKey: RecordPage`): header highlights, **Path** on `stage` with terminal `outcome` (success = Won), and main detail. No seeded document actions, quote line items, or related-list configs.

### Roles

**Sales Manager**, **Sales Rep**, **Pricing Manager** (`full_pack` CRUD on pack entities). Administrator remains kernel.

**Owner row security** is on for `account`, `contact`, `opportunity`, `message`, and `opportunity_item` (`backendConfig.rowLevelSecurity: "owner"`). Catalog / pricing entities stay shared (RLS off). Message also seeds **Also grant read if** → `to_user` (`backendConfig.rowLevelReadAlsoIf: ["to_user"]`) so recipients can open inbox rows without owning them — editable later in Setup → Entity parameters. Optional **Also grant read if same role as owner** (`rowLevelReadAlsoIfSameRole`) is off by default; turn it on per object in Setup when peer Sales Reps should read each other’s rows (update/delete stay owner-only). True Teams subsets remain a future platform task.

| Role | Owner RLS effect |
|------|------------------|
| Sales Rep | Sees / edits only rows they created on those CRM objects |
| Sales Manager | **View all** + **Modify all** on those objects (sees every rep’s book); **Author reports** for own-role reports |
| Pricing Manager | Unaffected on catalog (RLS off); full_pack elsewhere |

**n8n / imports:** login may use any active user. With RLS on, that user’s `user_created` owns new rows — use an admin automation user, a shared queue user with View all, or accept that Integration-owned leads stay private to that account until a manager views them.

### Seed data

None (`records.json` empty).

### Apply

```powershell
npm run platform:provision -- --domain sales
```

Or after kernel-only provision:

```powershell
npm run platform:apply-pack -- sales
```

### Export (persist Setup edits)

After changing fields, layouts, or seeded records in the UI:

```powershell
npm run platform:export-pack -- sales
```

Then commit the updated files under this folder.

---

## Pricing & promotions pack (`pricing`) — catalog, Campaign, promo prices

Detailed seed and job notes live in [`../pricing/README.md`](../pricing/README.md). Summary for the commercial Sales offering:

**Purpose:** Catalog hierarchy and price lists with seasonal / temporary discounts that keep promotion history via Campaign → Promotion → synced `promo_price` on Item Price.

| Entity | Purpose | Key fields |
|--------|---------|------------|
| `item_group` | Catalog hierarchy | self-M2O `parent` |
| `item` | Product / service | `base_price`, M2O `group` → Item group |
| `price_group` | Price list / facility price group | name |
| `campaign` | Marketing campaign master | date_start, date_end, description |
| `promotion` | Dated rule under a Campaign | campaign (required), date_start/end, promo_type (`fixed_price` \| `discount_percent`), fixed_price, discount_percent, optional scope: item / item_group / price_group, description |
| `item_price` | List row for an item in a price group | item (required), price_group, **price** (list), **promo_price** (readonly, job-maintained), **promotion** (winning rule) |

**Roles:** Pricing Manager (`full_pack`). Layouts: form + list for all six entities (no Tree/RecordPage seeds in pack JSON).

### Campaign → Promotion → promo prices

- Hierarchy: one Campaign owns many Promotions; the scheduled job **Sync promo prices** (`sync_promo_prices`) evaluates active rules and writes the winner onto each matching `item_price`.
- Sync uses **Promotion** `date_start` / `date_end` (not Campaign dates).
- Scope is an **AND** of every filled filter on the Promotion (`item`, `item_group`, `price_group`). Example: Item group = Cosmetic and Price group = Diller updates only Cosmetic items on the Diller list.
- While a promotion matches: set `promo_price` and `promotion`.
- When the window ends or no winner: clear `promotion` and set `promo_price = price` (list price remains the baseline).
- Consumers (e.g. related-transfer value fields) can use `price` or switch to `promo_price` in Setup; the pack does not rewrite existing mappings.
- Optional Setup: on Promotion date fields, **Default from parent field** from Campaign `date_start` / `date_end` when creating a Promotion from a Campaign related list.

**Operational follow-up after apply:** create a scheduled task with job type **Sync promo prices** (hourly recommended) so `promo_price` and `promotion` stay current.

```powershell
npm run platform:provision -- --domain pricing
npm run platform:apply-pack -- pricing
npm run platform:export-pack -- pricing
```

---

## REST API (BFF) for Sales entities

Integrations (n8n, external systems) can use the CoreEngine BFF REST surface against pack collections (`account`, `contact`, `opportunity`, `quote`, and pricing entities). Auth: `Authorization: Bearer` from `POST /auth/login`. Prefer `X-CRM-Automation: n8n` on automation calls. Full notes: [`docs/n8n-bff-flows.md`](../../../docs/n8n-bff-flows.md) and [`docs/generate-document-api.md`](../../../docs/generate-document-api.md).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` / `POST` | `/api/v1/query` | SOQL subset (`q=SELECT …`) |
| `GET` | `/api/v1/:collection` | List (`filter`, `fields`, `sort`, `limit`, `offset`) |
| `GET` | `/api/v1/:collection/:id` | Read one (PK or `uniqueField:value`) |
| `POST` | `/api/v1/:collection` | Create |
| `POST` | `/api/v1/:collection?upsert=true` | Upsert by `id` |
| `POST` | `/api/v1/:collection?upsert=true&by=<uniqueField>` | Upsert by unique field |
| `PUT` / `PATCH` | `/api/v1/:collection/:id` | Update (PK or `uniqueField:value`) |
| `DELETE` | `/api/v1/:collection/:id` | Soft-delete (`?hard=true` = hard delete) |
| `POST` | `/api/v1/documents/generate` | Phase 0 stub — HTTP 501, no file. In-app DocEngine is separate |

**SOQL-style query** (compiled to CoreEngine `findMany` — not raw SQL). Identifiers normalize to registry `api_name` (`Opportunity`→`opportunity`, `AccountId`→`account_id`).

```http
POST {{$env.BFF_URL}}/api/v1/query
Authorization: Bearer {{access_token}}
X-CRM-Automation: n8n
Content-Type: application/json

{
  "q": "SELECT Id, Name, account_id.Name FROM Opportunity WHERE Stage = 'Proposal' ORDER BY Amount DESC LIMIT 10"
}
```

Also: `GET /api/v1/query?q=` + URL-encoded SOQL. Supported: `SELECT` fields / `*` / `*, relation.path`, `FROM`, `WHERE` (`= != > >= < <= LIKE IN NOT IN IS NULL`, `AND`/`OR`, `()`), `ORDER BY`, `LIMIT`, `OFFSET`. Response: `{ collection, nodes, totalCount }`.

**CRUD examples (Sales)**

```http
GET {{$env.BFF_URL}}/api/v1/account/{{id}}?fields=id,name,industry,phone

GET {{$env.BFF_URL}}/api/v1/opportunity/{{id}}?expand=children
```

Returns the opportunity plus `_children` (every entity with an M2O FK to Opportunity, e.g. `quote`) and `_files` (attachments). Optional: `&childLimit=100`, `expand=children,nofiles`.

```http
GET {{$env.BFF_URL}}/api/v1/opportunity?limit=20&sort=-date_created&filter={"account_id":{"_eq":"..."}}

PATCH {{$env.BFF_URL}}/api/v1/opportunity/{{id}}
Content-Type: application/json

{ "stage": "Qualified", "amount": 12000 }

PATCH {{$env.BFF_URL}}/api/v1/account/external_id:{{externalId}}
Content-Type: application/json

{ "phone": "+380..." }
```

`:id` may be the primary key **or** `uniqueField:value` when the field has `is_unique` in Setup. Upsert by unique field: `POST /api/v1/account?upsert=true&by=external_id` with that field in the body.

**Generate document** (e.g. Opportunity quote PDF — **Phase 0 stub**: HTTP 501 / `DOCUMENTS_GENERATE_STUB` until populate/PDF lands; use in-app DocEngine today):

```http
POST {{$env.BFF_URL}}/api/v1/documents/generate
Authorization: Bearer {{access_token}}
X-CRM-Automation: n8n
Content-Type: application/json

{
  "collectionName": "opportunity",
  "recordId": "{{$json.recordId}}",
  "templateId": "{{$env.OPPORTUNITY_QUOTE_TEMPLATE_ID}}",
  "outputFormat": "pdf",
  "persist": true,
  "renderOutput": true
}
```

Bootstrap automation user for n8n: `npm run registry:seed-n8n-automation-user` (prints email/password once for `CRM_N8N_EMAIL` / `CRM_N8N_PASSWORD`).

**Message outbox (recommended):** multichannel notifications and automations (n8n channel connectors; one Message row per send). Create a `message` with **Is Draft** off → `queue_outbound_message` sets `delivery_status=queued`. Empty **Scheduled send at** → immediate `dispatch_outbound_message`; otherwise Tasks job **`dispatch_due_messages`** fires when due. Both rules also run **on update** when **Is Draft** changes (e.g. draft On → Off), via `requireChanged: is_draft`. Drafts skip auto-send until draft is cleared (save) or **Send**. Send always triggers flow key `dispatch_outbound_message`; **n8n** owns the rules (clear draft vs channel send + create inbox) — Message / Incoming message have **no BFF special-case code**. Import [`docs/n8n/dispatch-outbound-message.workflow.json`](../../../docs/n8n/dispatch-outbound-message.workflow.json) (optional PDF generate + file link when Opportunity + template env are set). Integration is **non-admin**: **Modify all** on `message` + `incoming_message`; **View all** on CRM entities needed for related reads / PDF under owner RLS.

**To user:** optional M2O `to_user` → `users` (Type **Internal**, or any type with `to_user` set). One Message row; sender remains **Owner**. Recipients get **read** via Owner RLS **Also grant read if** (`rowLevelReadAlsoIf: ["to_user"]` — Setup → Entity parameters on Message, or pack JSON). Update/delete stay owner-only. List view **For me** filters `to_user = $CURRENT_USER`. Example: Admin → Sales Rep: create Message, Type Internal, To user = Sales Rep.

**Incoming message (inbox):** ordinary object `incoming_message` owned by the recipient (same records API / RLS as other objects). Fields: subject, body, type, from_user / from_email, contact, opportunity, `source_message` → outbox `message`, and **Status** (`new` / `read`) — editable by the owner. No draft / schedule / delivery. Owner RLS only (no read-share). List view **Unread** filters `status = new`. Sales nav includes **Incoming messages**. The **n8n** dispatch workflow creates a new inbox row when `to_user` is set (after Mark sent) and back-links `message.source_message`. Share attachments onto the inbox via ordinary `/files/{id}/link` in n8n when needed. Integration has **View/Modify all** on `incoming_message`; Modify-all / system may set `owner_id` on create. Pack automation **Mark read on open** (`triggers: open`, condition `status = new`, set `status = read`) runs when the owner opens the record detail (platform On-open automations).

**From user / From email:** optional `from_user` (M2O → `users`) and `from_email` for the logical sender when Created By is the Integration/n8n account. Reply UI prefills **To user** from `from_user` (then owner / Created By) and quotes the inbound body with `>` lines.

**Messages created (Users profile):** platform registers audit Lookups `user_created` / `user_updated` → `users`, so Users Available Related Objects include `message_user_created`. Configure a Users Block Layout with a Messages created DataTable (binding key `message_user_created`) and attach it on the Users Record Page sidebar if needed. That list filters `user_created = this user` (authored), distinct from `message_to_user` (received). **Users layouts are never overwritten on re-apply** once present (`platform:apply-pack` skips existing `users` page/block layouts by settingId).

**Message timeline (Users / parent Record Page):** place a **Message timeline** component in the Record Page Builder. Point outgoing at `message` and incoming at `incoming_message`, set parent link fields (e.g. `from_user` / owner) and optional peer filter fields (e.g. `to_user` / `from_user`), and pick Compact Layouts for each bubble side. Runtime shows incoming left / outgoing right, Display Template titles, and Compact values without field labels.

Pack flow keys (your n8n): `npm run registry:seed-n8n-pack-flows -- --pack=sales` seeds `dispatch_outbound_message`, `send_quote_pdf`, `send_opportunity_document`, Message dual automations, and the due-messages task. Re-apply the sales pack (`npm run platform:apply-pack -- sales`) to refresh Integration bypass + entity automation from `entities.json` / `roles.json`.

---

## Platform capabilities used with Sales / Pricing (not pack-seeded templates)

These are generic CoreEngine features; pricing README and Documents pack document the intended Sales/Pricing usage:

- **Stage Path** on Opportunity Record Page (seeded in sales).
- **Highlights Compact views** — Inline (single-line header) or Panel (grid with field spans) for Compact Layout output on Record Page Highlights.
- **Message timeline** — configure on Users (or other parent) Record Pages for merged `message` + `incoming_message` threads; not pack-seeded by default.
- **Dynamic (lazy) lists:** object lists and related “View all” pages load rows on demand with server `limit` / `offset` + `totalCount` and infinite scroll (default page size 25). Embedded related lists on a record stay a compact preview (`rowLimit`, default 5) with **View all** for the full lazy list. Applies to Sales and Pricing entities (e.g. Item Price, Opportunity) without pack-specific seed.
- **Barcode reader (list view):** object / related list toolbars can enable HID wedge / barcode scan (`barcodeScan` on list settings). Scans match a configured field (e.g. `barcode`, `id`) and then **open**, **filter**, or **open-or-filter**; optional post-match field updates (`setFields`, toolbar Value → `updateField`) with confirm. Configure in Setup → list / DataTable settings — not seeded in the sales or pricing packs.
- **Item Price Tree & Document reports:** Tree layout groups Item Price by Item group (parent selection includes nested children); list Document report can map a “Price list by Group” template via `$payload.item_group_tree_rows` / `$children` (Documents pack). Within-group order uses Tree `main.sort`; currency/number formatting applies in docs. Packs do **not** currently seed a Tree layout, `doc_template`, or list `openDocument` action.
- **DocEngine** fill/generate from any record (e.g. Opportunity) via entity `openDocument` actions or CrmDocEngine fields — runtime ready; **no** seeded Opportunity or Price List templates in pack `records.json`.
- **Bulk update** engines (list `bulkUpdate`, record `bulkUpdateRelated`) can formula-patch numeric fields such as `item_price.price` — available in designers; **not** seeded as pack actions. There is no seeded `new_price` field.

Documents pack (`documents`) is always applied on provision (`doc_template` / `doc_value` / snapshots) and is the host for price-list and opportunity document templates when configured in Setup. See [`../documents/README.md`](../documents/README.md).

---

## What is intentionally out of seed today

- Quote line items, orders, invoices, leads.
- Seeded Tree Item Price layout, Price list `doc_template`, Opportunity document template/actions.
- Seeded demo records for sales or pricing.
- Automatic wiring of related lists (Campaign ↔ Promotions, Opportunity ↔ Quotes) beyond M2O fields and default form/list layouts.

---

## One-paragraph summary

**CoreEngine Sales** combines a CRM starter (Accounts, Contacts, Opportunities with stage Path, Quotes) with a Pricing & promotions catalog (Item groups, Items, Price groups, Item prices) where **Campaigns** own dated **Promotions** (fixed price or % off) that a scheduled **Sync promo prices** job applies onto Item Price as readonly **promo_price** plus the winning **promotion**, while list **price** stays the baseline—with dynamic/lazy object lists (and related View-all pages), list barcode scan, plus Tree price-list documents and opportunity docs via platform Document/Tree features once configured in Setup.
