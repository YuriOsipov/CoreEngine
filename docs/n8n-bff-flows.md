# n8n ↔ CRM BFF flows

Salesforce/Directus-style orchestration uses **n8n** for the graph and the **BFF** as the only write path into Postgres.

```text
CRM record action
  → POST /flows/trigger/:key   (JWT required)
      → app_flow_triggers handler=http
          → n8n webhook (+ X-CRM-Flow-Secret, X-CRM-Source: bff-flow)

n8n workflow
  → POST /auth/login           (n8n@system.local)
  → POST /graphql updateRecord (Bearer + X-CRM-Automation: n8n)
```

Do **not** let n8n write `crm_schema` with a Postgres node / service_role.

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

- Record create/update event hooks that skip when `automationSource` is set
- Optional local step pipeline inside BFF when n8n is overkill
