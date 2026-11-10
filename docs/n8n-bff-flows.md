# n8n ↔ CRM BFF flows

Salesforce/Directus-style orchestration uses **n8n** for the graph and the **BFF** as the only write path into Postgres.

```text
CRM record action (Form Builder button)
  → POST /flows/trigger/:key   (JWT required)
      → app_flow_triggers handler=http
          → n8n webhook (+ X-CRM-Flow-Secret, X-CRM-Source: bff-flow)

CRM record automation (Setup → Automations → Trigger flow)
  → create/update/delete commits
      → runLocalFlow(key)  (server-side, after save; failures are logged only)
          → app_flow_triggers handler=http|update_record
              → n8n webhook when handler=http

n8n workflow
  → POST /auth/login           (n8n@system.local)
  → POST /graphql updateRecord (Bearer + X-CRM-Automation: n8n)
  → POST /graphql generateDocument  (DocEngine; see generate-document-api.md)
```

Do **not** let n8n write `crm_schema` with a Postgres node / service_role.

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

Phase 0 stub today (HTTP 501 until populate/PDF is implemented). GraphQL `generateDocument` remains available as the same contract.

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

**Setup → Flows** manages `app_flow_triggers`: create a **key** (e.g. `test_hook`), set handler **HTTP**, paste the external URL, optionally set **Authentication** (None / Bearer / API key header / Basic). Then use that key in Object Manager → Automations → Trigger flow.

Outbound http also adds `X-CRM-Source: bff-flow` and, when set, `X-CRM-Flow-Secret` from `N8N_WEBHOOK_SECRET`.

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

Prefer `http` flow handlers from automations. An `update_record` handler can re-enter automations — use conditions / `requireChanged` carefully.

## Env (repo root `.env` and/or `crm-bff/.env`)

| Variable | Purpose |
|---|---|
| `N8N_WEBHOOK_URL` | Target URL for seeded http triggers |
| `N8N_WEBHOOK_SECRET` | Injected as `X-CRM-Flow-Secret` on outbound http flows |
| `FLOWS_TRIGGER_REQUIRE_AUTH` | Default `true` — JWT or service key required on `/flows/trigger` |
| `FLOWS_TRIGGER_SERVICE_KEY` | Optional machine credential (Bearer or `X-CRM-Flow-Secret`) |
| `FLOWS_REJECT_AUTOMATION_REENTRY` | Default `true` — refuse `/flows/trigger` when `X-CRM-Automation` is set |

## Bootstrap

```powershell
# 1) Automation user (prints password once)
npm run registry:seed-n8n-automation-user

# 2) Set webhook URL + optional shared secret in .env, then:
npm run registry:seed-n8n-flow-trigger

# 3) Auth smoke (no HTTP server required)
npm run registry:smoke-flow-trigger-auth

# 4) Bridge smoke (mock webhook + live BFF GraphQL write-back)
npm run registry:smoke-n8n-http-bridge
```

Form Builder action **Send to n8n** is attached to the `visit` entity layout by default (`--entity=` / `--key=` override).

## Importable n8n workflow

Import [`docs/n8n/crm-bff-flow.workflow.json`](./n8n/crm-bff-flow.workflow.json) into n8n, then set env:

- `BFF_URL` — e.g. `http://host.docker.internal:4000`
- `N8N_WEBHOOK_SECRET` — same as BFF `.env`
- `CRM_N8N_EMAIL` / `CRM_N8N_PASSWORD` — from `registry:seed-n8n-automation-user`

Activate the workflow, copy the Production webhook URL into `N8N_WEBHOOK_URL`, run `npm run registry:seed-n8n-flow-trigger`.

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
- Durable outbox / retries for failed `trigger_flow` dispatches
- Optional local step pipeline inside BFF when n8n is overkill
