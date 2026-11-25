# n8n / Activepieces ↔ CRM BFF flows

Salesforce/Directus-style orchestration uses **n8n** or **Activepieces** (MIT) for the graph and the **BFF** as the only write path into Postgres.

```text
CRM record action (Form Builder button)
  → POST /flows/trigger/:key   (JWT required)
      → app_flow_triggers handler=http
          → n8n / Activepieces webhook (+ X-CRM-Flow-Secret, X-CRM-Source: bff-flow)

CRM record automation (Setup → Automations → Call connection)
  → create/update/delete commits
      → runLocalFlow(key)  (server-side, after save; failures are logged only)
          → app_flow_triggers handler=http|update_record
              → automation webhook when handler=http

n8n / Activepieces workflow
  → POST /auth/login           (Integration user)
  → POST /graphql updateRecord (Bearer + X-CRM-Automation: n8n|activepieces)
  → POST /graphql generateDocument  (DocEngine; see generate-document-api.md)
```

Do **not** let the automation engine write `crm_schema` with a Postgres node / service_role.

Doc generation for automations / email: [`generate-document-api.md`](./generate-document-api.md)

```http
POST {{$env.BFF_URL}}/api/v1/documents/generate
Authorization: Bearer {{access_token}}
Content-Type: application/json

{
  "collectionName": "opportunity",
  "recordId": "{{$json.recordId}}",
  "templateId": "{{$env.OPPORTUNITY_QUOTE_TEMPLATE_ID}}",
  "outputFormat": "pdf"
}
```

Populate, persist, and PDF/HTML upload are implemented. Real PDF/HTML uses published `@docengine/pdf-renderer@0.0.105` (or `npm run docengine:use-local`). Contract: [`generate-document-api.md`](./generate-document-api.md). Importable workflow: [`n8n/generate-opportunity-document.workflow.json`](./n8n/generate-opportunity-document.workflow.json).

### REST records (n8n-friendly)

All require `Authorization: Bearer {{access_token}}`. Prefer `X-CRM-Automation: n8n`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` / `POST` | `/api/v1/query` | SOQL subset (`q=SELECT …`) |
| `GET` | `/api/v1/:collection` | List / select |
| `GET` | `/api/v1/:collection/:id` | Read one (PK or `uniqueField:value`; `?expand=children` nests reverse-M2O + files) |
| `POST` | `/api/v1/:collection` | Create |
| `POST` | `/api/v1/:collection?upsert=true` | Upsert by `id` |
| `POST` | `/api/v1/:collection?upsert=true&by=external_id` | Upsert by unique field |
| `PUT` / `PATCH` | `/api/v1/:collection/:id` | Update (PK or `uniqueField:value`) |
| `DELETE` | `/api/v1/:collection/:id` | Soft-delete (`?hard=true` = hard delete) |

`:id` may be the primary key **or** any single-field unique index as `fieldName:value` (first colon separates; URL-encode the value). The field must have `is_unique` in Setup (or a 1-field unique group).

**SOQL-style query** (compiled to CoreEngine `findMany` — not raw SQL)

```http
POST {{$env.BFF_URL}}/api/v1/query
Authorization: Bearer {{access_token}}
X-CRM-Automation: n8n
Content-Type: application/json

{
  "q": "SELECT Id, Name, Parent.Id FROM Account WHERE Industry = 'Technology' ORDER BY AnnualRevenue DESC LIMIT 5"
}
```

Or `GET {{$env.BFF_URL}}/api/v1/query?q=` + URL-encoded SOQL.

Supported subset: `SELECT` fields/`*`/`*, relation.path` `FROM` entity, `WHERE` (`= != > >= < <= LIKE IN NOT IN IS NULL`, `AND`/`OR`, parentheses), `ORDER BY`, `LIMIT`, `OFFSET`. Identifiers are normalized to CoreEngine `api_name` (`Account`→`account`, `AnnualRevenue`→`annual_revenue`). Response: `{ collection, nodes, totalCount }`.

**Read Account**

```http
GET {{$env.BFF_URL}}/api/v1/account/{{$json.record.account_id}}
```

Optional: `?fields=id,name,email`

**Read / patch by unique field**

```http
GET {{$env.BFF_URL}}/api/v1/account/external_id:{{$json.externalId}}

PATCH {{$env.BFF_URL}}/api/v1/account/external_id:{{$json.externalId}}
Content-Type: application/json

{ "phone": "+380..." }
```

**List opportunities**

```http
GET {{$env.BFF_URL}}/api/v1/opportunity?limit=20&sort=-date_created&filter={"account_id":{"_eq":"..."}}
```

(`filter` is URL-encoded JSON.)

**Update / create**

```http
PATCH {{$env.BFF_URL}}/api/v1/account/{{id}}
Content-Type: application/json

{ "phone": "+380..." }
```

```http
POST {{$env.BFF_URL}}/api/v1/account?upsert=true
Content-Type: application/json

{ "id": "...", "name": "Acme", "phone": "+380..." }
```

```http
POST {{$env.BFF_URL}}/api/v1/account?upsert=true&by=external_id
Content-Type: application/json

{ "external_id": "EXT-123", "name": "Acme", "phone": "+380..." }
```

### Setup UI

**Setup → Connections** manages `app_flow_triggers`: create a **key** (e.g. `send_quote_pdf`), set handler **HTTP**, choose Destination **Your n8n** (recommended), **Your Activepieces (MIT)**, or **Custom URL**.

- **Your n8n** stores `config.target=n8n` — no raw URL. At dispatch the BFF posts to `{N8N_BASE_URL}/webhook/ce-{key}` (e.g. `http://n8n:5678/webhook/ce-send_quote_pdf`). CoreEngine does not ship n8n; that URL is the instance you run.
- **Your Activepieces** stores `config.target=activepieces` + `config.flowId` (Catch Webhook Live URL id). Optional `config.sync=true` appends `/sync`. Dispatch URL: `{ACTIVEPIECES_BASE_URL}/api/v1/webhooks/{flowId}`. Headless seed (CE JWT, no Platform API keys): `npm run registry:seed-activepieces-flows`. See [`activepieces/README.md`](./activepieces/README.md).
- **Custom URL** stores an absolute `config.url` (legacy / other engines). Optional Authentication (None / Bearer / API key / Basic).

Then use that key in Object Manager → Automations → Call connection, or in Setup → Tasks with job type **Call connection** (`params`: `{ "connectionKey": "<key>", "payload": {} }`; legacy `send_notification` / `flowKey` still accepted). Promo price sync uses Connection `sync_promo_prices` + Activepieces template [`activepieces/sync-promo-prices.flow.json`](./activepieces/sync-promo-prices.flow.json).

Outbound http also adds `X-CRM-Source: bff-flow` and, when the destination is under `N8N_BASE_URL` / `N8N_WEBHOOK_URL` or `ACTIVEPIECES_BASE_URL`, `X-CRM-Flow-Secret` from `N8N_WEBHOOK_SECRET` or `ACTIVEPIECES_WEBHOOK_SECRET` (Activepieces falls back to the n8n secret when unset).

### Record automation payload

When an automation action `trigger_flow` matches, the BFF posts:

```json
{
  "source": "record_automation",
  "trigger": "create|update|delete",
  "collection": "opportunity_item",
  "recordId": "...",
  "record": {},
  "before": null,
  "automation": { "id": "...", "name": "..." }
}
```

Prefer `http` flow handlers from automations. An `update_record` handler can re-enter automations — use conditions / `requireChanged` carefully. JWT callers of `/flows/trigger` must pass FLS on the **merged** patch (including admin `config.patch`); in-process **system** dispatch (record automations / scheduler) does not. See [`security.md`](./security.md).

### Sales Message outbox

Multichannel notifications and automations. n8n supplies the channel connectors. Each send is one Message row; there is no threaded conversation view.

1. Rep creates a **Message** (Type / Body / Email or Phone / Contact / Opportunity, and/or **To user**, optional **Scheduled send at**).
2. Pack automation **`queue_outbound_message`** (create; `is_draft` ≠ true) sets `delivery_status=queued`.
3. If `scheduled_send_at` is empty, **`dispatch_outbound_message`** triggers immediately. If set, stay queued until Setup → Tasks **`dispatch_due_messages`** (params `{ "connectionKey": "dispatch_outbound_message", "limit": 50, "staleMinutes": 15, "maxAttempts": 5 }`) **claims** due rows with `FOR UPDATE SKIP LOCKED`. A claim sets `delivery_status=sending`, `sending_since=now`, and increments `attempts`. The same statement also reclaims `sending` rows whose `sending_since` is older than `staleMinutes` (a worker that died after the claim). At `maxAttempts` a stale `sending` row is marked `failed` and is not claimed. A thrown flow returns the row to `queued` and keeps `sending_since`, so the next try waits out that window instead of running on every tick. `sent` / `delivered` are not moved back to `queued`. Payload includes `idempotencyKey` (`ce-message-{id}`). Drafts skip auto-send. Setting **Delivery status** back to `queued` (or clearing **Is Draft**) resets `attempts` and `sending_since`.
4. n8n webhook `ce-dispatch_outbound_message` (`responseMode=lastNode`) owns all outbox rules (Message / Incoming are ordinary BFF objects). If `is_draft` → PATCH `is_draft=false` and stop (pack automations re-dispatch once). If already `sent` or `delivered` → skip SMTP / inbox create. Else: optional PDF → route on `record.type` → send (SMTP `Message-ID` = idempotency key) → Mark sent/failed. Mark failed sets `delivery_status` only and does not replace `body`. When `to_user` is set after Mark sent → POST `incoming_message` (owner=`to_user`) and link `message.source_message`. No BFF special-case for message/inbox.

   **Crash / reclaim duplicate gap (checked against the shipped template):** if SMTP (or another channel) succeeds and the process dies before **Mark sent**, the row stays `sending`. After `staleMinutes`, reclaim re-dispatches the same message. The shipped [`dispatch-outbound-message.workflow.json`](./n8n/dispatch-outbound-message.workflow.json) only skips when `delivery_status` is already `sent`/`delivered`; it does **not** dedupe on `idempotencyKey`. That key is copied into the SMTP `Message-ID` header only — MTAs do not treat it as a send lock — so a reclaim can deliver a second copy. `maxAttempts` bounds how many times that can happen; it does not make the first successful send unique. Custom workflows that truly dedupe on the key (provider idempotency API, outbox ledger, etc.) close this gap; the stock template does not.
5. Recipients see owned **Incoming message** rows from n8n; outbox Message **For me** / read-share (`rowLevelReadAlsoIf`) remains available. Update/delete stay owner-only.
6. Seed: `npm run registry:seed-n8n-pack-flows -- --pack=sales` (flows + Message automations + due-messages task). Template: [`n8n/dispatch-outbound-message.workflow.json`](./n8n/dispatch-outbound-message.workflow.json).

### Sales inbound email (IMAP)

External mailbox → per-user inbox. **Not** a BFF→n8n flow key — n8n polls IMAP and writes through the REST records API.

1. Re-apply sales pack so `incoming_message.external_message_id` is unique.
2. Import [`n8n/ingest-inbound-email.workflow.json`](./n8n/ingest-inbound-email.workflow.json); credential **CoreEngine IMAP** ([`n8n/imap.credentials.example.json`](./n8n/imap.credentials.example.json)).
3. Env on n8n: `BFF_URL`, `CRM_N8N_*`; optional `CRM_INBOUND_FALLBACK_OWNER_ID` (`backend_user_id`); optional `CRM_INBOUND_ROUTE_MAP` JSON address→owner map.
4. On each new mail: parse To/Cc → route map / `GET /api/v1/users/email:{addr}` / fallback → `POST /api/v1/incoming_message?upsert=true&by=external_message_id` (`type=email`, `owner_id` = matched user, `from_email`, Message-ID as `external_message_id`).
5. Activate the workflow in n8n; wire Error workflow → failed-execution-alert.

## Env (repo root `.env` and/or `crm-bff/.env`)

| Variable | Purpose |
|---|---|
| `N8N_BASE_URL` | Origin of the n8n instance you run (e.g. `http://n8n:5678`). Used when flow `config.target=n8n` |
| `N8N_WEBHOOK_URL` | Legacy single webhook URL for `registry:seed-n8n-flow-trigger`; also supplies origin fallback for `N8N_BASE_URL` |
| `N8N_WEBHOOK_SECRET` | Injected as `X-CRM-Flow-Secret` on outbound calls to the n8n origin (required in production when n8n is configured); also fallback for Activepieces |
| `N8N_ENCRYPTION_KEY` | Fixed key for the n8n process (compose) so credentials survive container recreate |
| `ACTIVEPIECES_BASE_URL` | Origin of Activepieces (e.g. `http://activepieces:80`). Used when flow `config.target=activepieces` |
| `ACTIVEPIECES_WEBHOOK_SECRET` | Injected as `X-CRM-Flow-Secret` on outbound calls to the Activepieces origin (falls back to `N8N_WEBHOOK_SECRET`) |
| `FLOWS_HTTP_ALLOWED_HOSTS` | Comma hosts allowed for private/Docker targets (minimal compose sets `n8n,n8n:5678`; add Activepieces host when used) |
| `FLOWS_TRIGGER_REQUIRE_AUTH` | Default `true` — JWT or service key required on `/flows/trigger` |
| `FLOWS_TRIGGER_SERVICE_KEY` | Optional machine credential (Bearer or `X-CRM-Flow-Secret`) |
| `FLOWS_REJECT_AUTOMATION_REENTRY` | Default `true` — refuse `/flows/trigger` when `X-CRM-Automation` is set |

## Bootstrap

```powershell
# 1) Automation user (prints password once → CRM_N8N_EMAIL / CRM_N8N_PASSWORD)
npm run registry:seed-n8n-automation-user

# 2) Preferred: N8N_BASE_URL + pack keys (no raw URLs in Setup)
#    N8N_BASE_URL=http://n8n:5678
#    N8N_WEBHOOK_SECRET=…
#    N8N_ENCRYPTION_KEY=…   # fixed; required by compose profile automation
npm run registry:seed-n8n-pack-flows -- --pack=sales

#    Legacy single URL instead:
#    N8N_WEBHOOK_URL=… then npm run registry:seed-n8n-flow-trigger

# 3) Auth smoke (no HTTP server required)
npm run registry:smoke-flow-trigger-auth

# 4) Bridge smoke (mock webhook + live BFF GraphQL write-back)
npm run registry:smoke-n8n-http-bridge

# 5) Optional Docker n8n
docker compose -f docker-compose.minimal.yml --profile automation up -d n8n
```

Form Builder action **Send to n8n** is attached to the `visit` entity layout by default (`--entity=` / `--key=` override).

## Importable n8n workflows

Catalog (quote PDF + message status, appointment reminder, inbound IMAP, document generate, failed-execution alert): [`n8n/README.md`](./n8n/README.md). Hardening checklist (localhost bind, encryption key, node exclude, Integration ACL): same doc → **Hardening**.

For your n8n, import the template whose webhook path is `ce-{key}`, activate it, and keep Setup → Connections on **Your n8n**. From Docker n8n set:

- `BFF_URL` — `http://bff:4000`
- `N8N_WEBHOOK_SECRET` — same as BFF `.env` (templates reject calls without matching `X-CRM-Flow-Secret`)
- `N8N_ENCRYPTION_KEY` — fixed; never rotate casually without re-entering credentials
- `CRM_N8N_EMAIL` / `CRM_N8N_PASSWORD` — non-admin Integration from `registry:seed-n8n-automation-user`
- Inbound IMAP (optional): `CRM_INBOUND_FALLBACK_OWNER_ID`, optional `CRM_INBOUND_ROUTE_MAP` — see [`n8n/ingest-inbound-email.workflow.json`](./n8n/ingest-inbound-email.workflow.json)

## n8n workflow sketch

1. **Webhook** — receive `{ collection, recordId, record, action }`
2. Optional: verify `X-CRM-Flow-Secret` equals `N8N_WEBHOOK_SECRET`
3. **HTTP** `POST {{$env.BFF_URL}}/auth/login` with automation email/password
4. **HTTP** GraphQL:

```json
{
  "query": "mutation($e:String!,$id:ID!,$d:JSON!){ updateRecord(entity:$e,id:$id,data:$d) }",
  "variables": {
    "e": "{{$json.collection}}",
    "id": "{{$json.recordId}}",
    "d": { "status": "draft" }
  }
}
```

Headers on every GraphQL call:

- `Authorization: Bearer {{access_token}}`
- `X-CRM-Automation: n8n`

5. Side effects (Slack, email, …)

## Loop avoidance

- Outbound BFF→n8n is tagged `X-CRM-Source: bff-flow`
- Inbound n8n→BFF GraphQL should send `X-CRM-Automation: n8n` (for future event-hook skip; not yet on Yoga context)
- `/flows/trigger` returns **409** if `X-CRM-Automation` is present (n8n must not re-fire flows via trigger)

## Later (not in this milestone)

- `skipRecordAutomations` on flow-driven `update_record` writes to prevent loops
- Retries / durable outbox for failed `trigger_flow` dispatches (failures are stored in `app_flow_dispatches` and listed under Setup → Connections → Failed runs; they are not replayed)
- Optional local step pipeline inside BFF when n8n is overkill
