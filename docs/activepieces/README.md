# Activepieces (MIT) ↔ CoreEngine

[Activepieces](https://www.activepieces.com/) is an **optional** MIT-licensed alternative to n8n for durable multi-step flows. CoreEngine does **not** bake Activepieces into its image or installer — profile `automation-activepieces` in `docker-compose.minimal.yml` only names the upstream image `ghcr.io/activepieces/activepieces`. You pull it yourself.

**Same contract as n8n:** CoreEngine stays the only write path into Postgres. Activepieces orchestrates; it must not write `crm_schema` with a Postgres piece / service role. Use BFF GraphQL or REST + the Integration user (`CRM_N8N_EMAIL` / `CRM_N8N_PASSWORD` from `npm run registry:seed-n8n-automation-user`).

License notes: [`../../THIRD_PARTY.md`](../../THIRD_PARTY.md). Runbook shared with n8n: [`../n8n-bff-flows.md`](../n8n-bff-flows.md).

## Why a flow id (not `ce-{key}`)

n8n webhooks can use a stable path `/webhook/ce-{key}`. Activepieces Catch Webhook URLs are:

```text
{ACTIVEPIECES_BASE_URL}/api/v1/webhooks/{flowId}
{ACTIVEPIECES_BASE_URL}/api/v1/webhooks/{flowId}/sync   # wait for Return Response
```

`flowId` is the last segment of the trigger’s **Live URL** in the Activepieces UI. Setup → Connections stores `config.target=activepieces` + `config.flowId` (optional `config.sync=true`).

## Seamless client model

| Who | Sees |
|-----|------|
| Receptionist / sales rep | Message / records — same as n8n path |
| Client admin | Setup → Connections keys on/off — Destination **Your Activepieces (MIT)** + flow id (no raw full URL) |
| You / partner | Activepieces canvas, credentials, SMTP / Slack connections |

## Optional upstream Activepieces (minimal stack)

Uses a **dedicated** Postgres + Redis (not CoreEngine `db`). UI on **127.0.0.1:8081** so it does not clash with CoreEngine web on `:8080`.

```bash
# After provision + Integration user:
npm run registry:seed-n8n-automation-user   # note printed password → .env CRM_N8N_*

# Required in .env (generate once; keep stable across recreate):
#   AP_ENCRYPTION_KEY=$(openssl rand -hex 16)   # 32 hex chars
#   AP_JWT_SECRET=$(openssl rand -hex 32)
#   AP_POSTGRES_PASSWORD=…                      # dedicated AP database
#   ACTIVEPIECES_BASE_URL=http://127.0.0.1:8082  # host BFF; Docker BFF → http://activepieces:80
#   ACTIVEPIECES_WEBHOOK_SECRET=…               # or reuse N8N_WEBHOOK_SECRET
# Optional: ACTIVEPIECES_PUBLISH_PORT=8082, AP_FRONTEND_URL=http://127.0.0.1:8082

docker compose -f docker-compose.minimal.yml --profile automation-activepieces up -d
# Open http://127.0.0.1:8081 → create first admin → Catch Webhook flows
# Restart BFF after setting ACTIVEPIECES_BASE_URL so production secret checks apply:
docker compose -f docker-compose.minimal.yml up -d bff
```

The lightweight installer does not pull or start these containers (`--with-activepieces` / `-WithActivepieces` are refused).

| Compose service | Role |
|-----------------|------|
| `activepieces` | App + UI (host `127.0.0.1:8081` → container `:80`) |
| `activepieces-worker` | Runs flows (`AP_FRONTEND_URL=http://activepieces` for Docker DNS) |
| `activepieces-db` | pgvector Postgres for Activepieces only |
| `activepieces-redis` | Job queue |

## Env

| Variable | Used by |
|----------|---------|
| `ACTIVEPIECES_BASE_URL` | Origin the BFF reaches. Host `bff:dev` → `http://127.0.0.1:{ACTIVEPIECES_PUBLISH_PORT}`; Compose BFF → `http://activepieces:80`. Required for `target=activepieces` |
| `ACTIVEPIECES_WEBHOOK_SECRET` | Injected as `X-CRM-Flow-Secret` on BFF → Activepieces. Falls back to `N8N_WEBHOOK_SECRET` if unset |
| `ACTIVEPIECES_PUBLISH_PORT` | Host port for the UI (default `8081`) |
| `AP_FRONTEND_URL` | URL browsers use (default `http://127.0.0.1:8081`) — Live URLs in the UI |
| `AP_ENCRYPTION_KEY` | 32 hex chars — required by compose; keep fixed or connections become unreadable |
| `AP_JWT_SECRET` | Required by compose |
| `AP_POSTGRES_PASSWORD` | Password for `activepieces-db` |
| `FLOWS_HTTP_ALLOWED_HOSTS` | Include `activepieces,activepieces:80` (minimal compose default already does) |
| `BFF_URL` | Reachable BFF from Activepieces. Host `bff:dev` → `http://host.docker.internal:4000`; Compose BFF → `http://bff:4000` |
| `CRM_N8N_EMAIL` / `CRM_N8N_PASSWORD` | Same Integration user as n8n templates |

Production BFF refuses to start if `ACTIVEPIECES_BASE_URL` is set without a webhook secret.

## Setup → Connections

1. Start profile `automation-activepieces` (or any reachable Activepieces). Set `AP_FRONTEND_URL` to the URL you open in the browser.
2. Create a flow: **Catch Webhook** → auth **Header** → header name `X-CRM-Flow-Secret` → value = shared secret.
3. Copy the Live URL id → Setup → Connections → Destination **Your Activepieces (MIT)** → paste flow id. Optional: **Wait for response (/sync)**.
4. Add HTTP pieces: `POST {BFF_URL}/auth/login`, then GraphQL / REST with `Authorization: Bearer {{…body.access_token}}` and `X-CRM-Automation: activepieces`.
   The HTTP piece nests JSON under **`body`** — use `BFF Login → body → access_token`, not a top-level `access_token`. Easier: Credentials → **Bearer Token** and paste that same field as Token.
   With host `npm run bff:dev` (no Compose `bff` container), use `http://host.docker.internal:4000` in every HTTP URL — `http://bff:4000` only resolves when the Compose `bff` service is up.
5. Prefer leaving pack seeds on n8n when this customer uses only Activepieces — switch each flow key’s destination in Setup.

## Piece sketch (Message outbox / document)

Mirror [`../n8n/dispatch-outbound-message.workflow.json`](../n8n/dispatch-outbound-message.workflow.json):

1. Catch Webhook (Header Auth as above)
2. IF secret already verified by Catch Webhook — continue
3. HTTP login → store token
4. Branch on payload (draft clear vs send)
5. Optional `generateDocument` / REST PATCH message `delivery_status`
6. SMTP / channel send via Activepieces pieces
7. Optional Return Response when Setup has **Wait for response**

Importable template: [`dispatch-outbound-message.flow.json`](./dispatch-outbound-message.flow.json) (Activepieces **Template** shape: `{ name, flows: [{ trigger, … }] }` — not a raw flow version). After import, set Catch Webhook header secret + BFF login email/password, publish, then paste the Live URL id into Setup → Connections.

## Hardening

| Topic | Practice |
|-------|----------|
| **Webhook secret** | BFF sends `X-CRM-Flow-Secret` only to hosts under `ACTIVEPIECES_BASE_URL`. Configure Catch Webhook Header Auth to require that header. |
| **No direct DB** | HTTP/GraphQL to BFF only — never point pieces at CoreEngine Postgres |
| **Network** | UI bound to loopback; BFF uses Docker DNS `activepieces:80` |
| **Keys** | Keep `AP_ENCRYPTION_KEY` / `AP_JWT_SECRET` fixed across recreate |

## Related

- n8n templates (default pack path): [`../n8n/README.md`](../n8n/README.md)
- Document generate API: [`../generate-document-api.md`](../generate-document-api.md)
