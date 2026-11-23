# n8n templates

Import these into n8n (**Workflows → Import from file**). Production pack flows stay inactive until you add env and activate them.

**Source of truth:** the `*.workflow.json` files in this folder are what we ship and review in git. After you edit a workflow in the n8n UI, **re-export** it back over the matching file here (Workflow → Download / Export) so the repo stays authoritative.

CoreEngine stays the only write path into Postgres. Do not add a Postgres node aimed at `crm_schema`.

n8n is not part of CoreEngine. Profile `automation` in `docker-compose.minimal.yml` only names the upstream image `n8nio/n8n`. You pull it yourself. The installers refuse `--with-n8n` / `-WithN8n`. n8n Community Edition is free for internal business use; hosted or resold use needs a separate agreement with n8n. White-labeling n8n, hosting it and charging for access, or putting it inside a commercial product or appliance is outside the Sustainable Use License. Sell implementation and support on the customer’s own instance, not “n8n access.” A managed host or a true bundle needs a commercial agreement: [license@n8n.io](mailto:license@n8n.io). This is not legal advice; confirm with them. Component list: [`../../THIRD_PARTY.md`](../../THIRD_PARTY.md).

## Seamless client model

| Who | Sees |
|-----|------|
| Receptionist / sales rep | **Message** list / related list (`Type`, `Result`, `Delivery status`) — create a Message to send |
| Client admin | Setup → Flows keys (`dispatch_outbound_message`, …) on/off — **no raw n8n URLs** when Destination = Your n8n |
| You / partner | n8n canvas, credentials, Slack/Telegram failed-execution alerts |

**Preferred outbox:** multichannel notifications and automations. `message` / `incoming_message` are ordinary objects — **no BFF special-case code**. Create a Sales `message` row (with **Is Draft** off) → pack automation `queue_outbound_message` sets `delivery_status=queued`. If **Scheduled send at** is empty, `dispatch_outbound_message` fires the n8n flow; if set, Setup → Tasks **`dispatch_due_messages`** marks `sending` and triggers the same flow when due. The same pack rules also run **on update** when **Is Draft** changes (draft On → Off).

**Send button / n8n rules** (in [`dispatch-outbound-message.workflow.json`](./dispatch-outbound-message.workflow.json)): if the Message is still draft → PATCH `is_draft=false` and stop (automations queue + dispatch once); if not draft → channel send → Mark sent → when **To user** is set, **POST** a new `incoming_message` (owner=`to_user`) and link `message.source_message`. Integration has **Modify all** on `incoming_message` and may pass `owner_id` on create.

**User → user:** set **To user** (`to_user`). Recipients get an owned **Incoming message** from the n8n workflow; Message **For me** / read-share remains available for the outbox row. For Type Internal, n8n should `GET /api/v1/users/{to_user}` and email that address (A); in-app inbox is B.

**From (inbound / integration):** set **From user** (`from_user`) and/or **From email** (`from_email`) on the Message when the row is created by the Integration (n8n) user — Created By stays the automation account, while From shows the real sender. UI Reply prefers `from_user` as the reply recipient (then owner / Created By).

Convention: flow key `dispatch_outbound_message` → n8n webhook path **`ce-dispatch_outbound_message`**. BFF resolves `{N8N_BASE_URL}/webhook/ce-{key}` when the flow has `config.target=n8n`.

Delivery outcome is tracked only via `delivery_status` (`queued` / `sending` / `sent` / `delivered` / `failed`) — put free-text errors in `body`. Integration needs **View/Modify all** on `message` (seeded in the Sales pack) so write-back works for rep-owned rows.

### Pack / production templates

| Template | Flow key / webhook path | When to use |
|----------|-------------------------|-------------|
| [`dispatch-outbound-message.workflow.json`](./dispatch-outbound-message.workflow.json) | `dispatch_outbound_message` → `ce-dispatch_outbound_message` | **Sales Message outbox:** draft clear vs send; optional PDF; route by Type → SMTP → Mark sent/failed; create `incoming_message` when `to_user` set |
| [`send-quote-pdf.workflow.json`](./send-quote-pdf.workflow.json) | `send_quote_pdf` → `ce-send_quote_pdf` | Sales: queue message → generate PDF → link → mark Sent |
| [`send-appointment-reminder.workflow.json`](./send-appointment-reminder.workflow.json) | `send_appointment_reminder` → `ce-send_appointment_reminder` | Clinic: mark reminder Queued → stub send → Sent |
| [`generate-opportunity-document.workflow.json`](./generate-opportunity-document.workflow.json) | `send_opportunity_document` → `ce-send_opportunity_document` | Document generate only (no message row) |
| [`failed-execution-alert.workflow.json`](./failed-execution-alert.workflow.json) | Error Trigger (not a webhook) | POST JSON alert when a linked workflow fails — select under **Settings → Error workflow**; do not flip Active for normal polling |

### Optional samples (inactive examples)

Leave these **inactive** unless you are demoing a one-off pattern. They are not seeded by `registry:seed-n8n-pack-flows`.

| Template | Webhook / pattern | Notes |
|----------|-------------------|-------|
| [`crm-bff-flow.workflow.json`](./crm-bff-flow.workflow.json) | custom / `crm-flow` | Sample GraphQL `updateRecord` write-back |
| [`record-rest-patch.workflow.json`](./record-rest-patch.workflow.json) | custom | Sample REST `PATCH /api/v1/:collection/:id` after webhook |
| [`upsert-by-external-id.workflow.json`](./upsert-by-external-id.workflow.json) | inbound | Sample external system posts `{ external_id, … }` → upsert |

Runbook (payload shape, auth, loop avoidance): [`../n8n-bff-flows.md`](../n8n-bff-flows.md). Document generate contract: [`../generate-document-api.md`](../generate-document-api.md).

## Env on the n8n process

| Variable | Used by |
|----------|---------|
| `BFF_URL` | All write/read templates. From Docker n8n: `http://bff:4000` |
| `N8N_WEBHOOK_SECRET` | Same value as the BFF. Checked on CoreEngine → n8n webhooks (`X-CRM-Flow-Secret`) |
| `N8N_ENCRYPTION_KEY` | n8n credential encryption — fixed value in `.env`, required by compose |
| `CRM_N8N_EMAIL` / `CRM_N8N_PASSWORD` | From `npm run registry:seed-n8n-automation-user` (non-admin Integration) |
| `CRM_PATCH_FIELD` / `CRM_PATCH_VALUE` | REST patch template (default field `note`) |
| `OPPORTUNITY_QUOTE_TEMPLATE_ID` | Document / quote templates (also used by outbox when `message.opportunity` is set) |
| `MESSAGE_DOC_TEMPLATE_ID` | Optional override for outbox PDF generate |
| `SMTP_FROM` | From address for outbox **Send email** (e.g. `CoreEngine <you@gmail.com>`) |

**Real email (Message Type = Email):** create n8n credential **CoreEngine SMTP** (Credentials → SMTP; Gmail needs an [App Password](https://myaccount.google.com/apppasswords)). Example shape: [`smtp.credentials.example.json`](./smtp.credentials.example.json). On `dispatch-outbound-message`, select that credential on **both** Send email nodes. Set `SMTP_FROM` on the n8n process to match. Attachments: **all** files on the Message (Files panel), plus a generated PDF when Opportunity + template env are set.
| `N8N_INBOUND_SECRET` | Header `X-CRM-Inbound-Secret` on the upsert webhook |
| `CRM_UPSERT_COLLECTION` / `CRM_UPSERT_BY` | Default `account` / `external_id` (field must be unique) |
| `ALERT_WEBHOOK_URL` | Failed-execution alert (Slack incoming webhook or any JSON POST) |

## Optional upstream n8n (minimal stack)

```bash
# After provision + Integration user:
npm run registry:seed-n8n-automation-user   # note printed password → .env CRM_N8N_*
# Add N8N_WEBHOOK_SECRET + N8N_ENCRYPTION_KEY (fixed) and N8N_BASE_URL=http://n8n:5678 to .env
npm run registry:seed-n8n-pack-flows -- --pack=sales   # or clinic / all

docker compose -f docker-compose.minimal.yml --profile automation up -d n8n
# Open http://127.0.0.1:5678 → Import from file → docs/n8n/*.workflow.json → Activate
# On each workflow: Settings → Error workflow → CoreEngine — failed execution alert
```

The lightweight installer does not pull or start this container. Set `N8N_WEBHOOK_SECRET`, `N8N_ENCRYPTION_KEY`, and `N8N_BASE_URL` in `.env` yourself, then run the compose command above.

## Hardening (your n8n)

Vendor guidance applied in `docker-compose.minimal.yml` + pack seeds:

| Control | What CoreEngine does |
|---------|----------------------|
| **Network** | Publishes `127.0.0.1:5678` only (not LAN/`0.0.0.0`). BFF dispatch uses Docker DNS `http://n8n:5678` — no public webhook exposure required. For production without a local editor, remove the `ports:` mapping and reach the UI via SSH tunnel or an authenticating reverse proxy. |
| **Webhook secret** | BFF sends `X-CRM-Flow-Secret` from `N8N_WEBHOOK_SECRET` on every call under `N8N_BASE_URL`. Stock templates IF-check that header against `$env.N8N_WEBHOOK_SECRET` before login. Production BFF refuses to start if n8n is configured without the secret. |
| **Encryption key** | Set a fixed `N8N_ENCRYPTION_KEY` in `.env` and keep the `coreengine_n8n` volume. Recreating the container without the same key makes stored SMTP/API credentials unreadable. |
| **Node lockdown** | `NODES_EXCLUDE` drops Execute Command, Read/Write Files, and Git. Execution history pruning defaults on (`EXECUTIONS_DATA_PRUNE`, 7-day max age). |
| **Env access in nodes** | Stock CE templates need `$env` (`BFF_URL`, `CRM_N8N_*`, `N8N_WEBHOOK_SECRET`, `SMTP_FROM`). Leave `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` until those move into n8n Credentials / `$vars`, then set `true`. |
| **Integration user** | `npm run registry:seed-n8n-automation-user` creates a **non-admin** Integration user. Sales pack grants **Modify all** on `message` + `incoming_message` (outbox PATCH + inbox create with `owner_id=to_user`); **View all** on CRM entities needed for related reads / PDF under owner RLS. Do not pass `--admin` for day-to-day n8n. |

## Wire a CoreEngine flow key

**Recommended (your n8n):**

1. Seed keys: `npm run registry:seed-n8n-pack-flows`
2. Or Setup → Flows → New → Destination **Your n8n** → key e.g. `send_quote_pdf`
3. Import + activate the matching workflow (webhook path `ce-{key}`)
4. Put that key on Automations → Trigger flow (never a raw URL)

**Legacy single URL:** set `N8N_WEBHOOK_URL` and run `npm run registry:seed-n8n-flow-trigger` (stores an absolute URL).

## Failed runs

Three signals, on purpose:

- **Message row** — outbox SMTP (or channel) failure runs **Mark failed** (`delivery_status=failed`, error text in `body`), then rethrows so the execution still errors.
- **Inside CoreEngine** — Setup → Flows → **Failed runs** (outbound `runLocalFlow` errors, kept 90 days). Outbox webhook uses `responseMode=lastNode`, so a failed send returns an error to the BFF and appears here. Setup → Tasks → **Failed runs** covers scheduled jobs (`FAILED`); per-task **History** remains.
- **Optional admin email** — Setup → General → **Failed-run alerts** (needs platform `SMTP_HOST` / `SMTP_FROM`). Or set `FAILED_RUN_NOTIFY_EMAIL` / `FAILED_RUN_NOTIFY=true`. Same flow/task key is not emailed again for 15 minutes.
- **Inside n8n** — Executions, filter **Error**. Import [`failed-execution-alert.workflow.json`](./failed-execution-alert.workflow.json), set `ALERT_WEBHOOK_URL`, then on each pack workflow open **Settings → Error workflow** and select **CoreEngine — failed execution alert** (Error Trigger workflows are not toggled Active like webhooks). n8n does not call that workflow unless the failing workflow points at it.

**Smoke the failure path:** break SMTP on purpose (wrong host/password) → create/Send a Message → confirm `delivery_status=failed`, Setup → Flows → Failed runs has `dispatch_outbound_message`, and the alert webhook receives a POST. Re-export the outbox JSON if you changed the canvas.

In-process jobs are still a timer in each BFF process. Run the scheduler on one process (`TASK_SCHEDULER_ENABLED=false` on the others).
