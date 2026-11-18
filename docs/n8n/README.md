# n8n templates

Import these into n8n (**Workflows → Import from file**). They stay inactive until you add env and activate them.

CoreEngine stays the only write path into Postgres. Do not add a Postgres node aimed at `crm_schema`.

## Seamless client model

| Who | Sees |
|-----|------|
| Receptionist / sales rep | **Message** list / related list (`Type`, `Result`, `Delivery status`) — create a Message to send |
| Client admin | Setup → Flows keys (`dispatch_outbound_message`, …) on/off — **no raw n8n URLs** when Destination = Bundled n8n |
| You / partner | n8n canvas, credentials, Slack/Telegram failed-execution alerts |

**Preferred outbox:** create a Sales `message` row → `queue_outbound_message` sets `delivery_status=queued`. If **Scheduled send at** is empty, `dispatch_outbound_message` fires immediately; if set, Setup → Tasks **`dispatch_due_messages`** (every 5 min) marks `sending` and triggers the same flow when due. n8n routes on `type` (1 Email / 2 WhatsApp / 3 Telegram / **4 Internal**) → optional PDF generate + `/files/{id}/link` → PATCH `result` + `delivery_status`.

**User → user:** set **To user** (`to_user`). Recipients see those rows via list view **For me** (and RLS read-share). For Type Internal, n8n should `GET /api/v1/users/{to_user}` and email that address (A); in-app visibility is B.

Convention: flow key `dispatch_outbound_message` → n8n webhook path **`ce-dispatch_outbound_message`**. BFF resolves `{N8N_BASE_URL}/webhook/ce-{key}` when the flow has `config.target=n8n`.

`result` is an integer choice (**1 Success / 2 Failed**) — put free-text errors in `body`, not in `result`. Integration needs **View/Modify all** on `message` (seeded in the Sales pack) so write-back works for rep-owned rows.

| Template | Flow key / webhook path | When to use |
|----------|-------------------------|-------------|
| [`dispatch-outbound-message.workflow.json`](./dispatch-outbound-message.workflow.json) | `dispatch_outbound_message` → `ce-dispatch_outbound_message` | **Sales Message outbox:** create / due → optional PDF attach → route by Type → PATCH |
| [`send-quote-pdf.workflow.json`](./send-quote-pdf.workflow.json) | `send_quote_pdf` → `ce-send_quote_pdf` | Sales: queue message → generate PDF → link → mark Sent |
| [`send-appointment-reminder.workflow.json`](./send-appointment-reminder.workflow.json) | `send_appointment_reminder` → `ce-send_appointment_reminder` | Clinic: mark reminder Queued → stub send → Sent |
| [`generate-opportunity-document.workflow.json`](./generate-opportunity-document.workflow.json) | `send_opportunity_document` → `ce-send_opportunity_document` | Document generate only (no message row) |
| [`crm-bff-flow.workflow.json`](./crm-bff-flow.workflow.json) | custom / `crm-flow` | Demo GraphQL `updateRecord` |
| [`record-rest-patch.workflow.json`](./record-rest-patch.workflow.json) | custom | REST `PATCH /api/v1/:collection/:id` |
| [`upsert-by-external-id.workflow.json`](./upsert-by-external-id.workflow.json) | inbound | Another system posts `{ external_id, … }` → upsert |
| [`failed-execution-alert.workflow.json`](./failed-execution-alert.workflow.json) | Error Trigger | POST JSON alert when a linked workflow fails |

Runbook (payload shape, auth, loop avoidance): [`../n8n-bff-flows.md`](../n8n-bff-flows.md). Document generate contract: [`../generate-document-api.md`](../generate-document-api.md).

## Env on the n8n process

| Variable | Used by |
|----------|---------|
| `BFF_URL` | All write/read templates. From Docker n8n: `http://bff:4000` |
| `N8N_WEBHOOK_SECRET` | Same value as the BFF. Checked on CoreEngine → n8n webhooks |
| `CRM_N8N_EMAIL` / `CRM_N8N_PASSWORD` | From `npm run registry:seed-n8n-automation-user` |
| `CRM_PATCH_FIELD` / `CRM_PATCH_VALUE` | REST patch template (default field `note`) |
| `OPPORTUNITY_QUOTE_TEMPLATE_ID` | Document / quote templates (also used by outbox when `message.opportunity` is set) |
| `MESSAGE_DOC_TEMPLATE_ID` | Optional override for outbox PDF generate |
| `SMTP_FROM` | From address for outbox **Send email** (e.g. `CoreEngine <you@gmail.com>`) |

**Real email (Message Type = Email):** create n8n credential **CoreEngine SMTP** (Credentials → SMTP; Gmail needs an [App Password](https://myaccount.google.com/apppasswords)). Example shape: [`smtp.credentials.example.json`](./smtp.credentials.example.json). On `dispatch-outbound-message`, select that credential on **both** Send email nodes. Set `SMTP_FROM` on the n8n process to match. Attachments: **all** files on the Message (Files panel), plus a generated PDF when Opportunity + template env are set.
| `N8N_INBOUND_SECRET` | Header `X-CRM-Inbound-Secret` on the upsert webhook |
| `CRM_UPSERT_COLLECTION` / `CRM_UPSERT_BY` | Default `account` / `external_id` (field must be unique) |
| `ALERT_WEBHOOK_URL` | Failed-execution alert (Slack incoming webhook or any JSON POST) |

## Bundle with Docker (minimal stack)

```bash
# After provision + Integration user:
npm run registry:seed-n8n-automation-user   # note printed password → .env CRM_N8N_*
# Add N8N_WEBHOOK_SECRET (shared) and N8N_BASE_URL=http://n8n:5678 to .env
npm run registry:seed-n8n-pack-flows -- --pack=sales   # or clinic / all

docker compose -f docker-compose.minimal.yml --profile automation up -d n8n
# Open http://localhost:5678 → Import from file → docs/n8n/*.workflow.json → Activate
# On each workflow: Settings → Error workflow → CoreEngine — failed execution alert
```

Install helpers: `./scripts/install-minimal.sh --with-n8n` or `install-minimal.ps1 -WithN8n`.

## Wire a CoreEngine flow key

**Recommended (bundled n8n):**

1. Seed keys: `npm run registry:seed-n8n-pack-flows`
2. Or Setup → Flows → New → Destination **Bundled n8n** → key e.g. `send_quote_pdf`
3. Import + activate the matching workflow (webhook path `ce-{key}`)
4. Put that key on Automations → Trigger flow (never a raw URL)

**Legacy single URL:** set `N8N_WEBHOOK_URL` and run `npm run registry:seed-n8n-flow-trigger` (stores an absolute URL).

## Failed runs

Two places, on purpose:

- **Inside CoreEngine** — Setup → Flows → **Failed runs** (outbound `runLocalFlow` errors, kept 90 days). Setup → Tasks → **Failed runs** (scheduled jobs with status `FAILED`). Per-task **History** is still there.
- **Optional admin email** — Setup → General → **Failed-run alerts** (needs `SMTP_HOST` / `SMTP_FROM`). Or set `FAILED_RUN_NOTIFY_EMAIL` / `FAILED_RUN_NOTIFY=true`. Same flow/task key is not emailed again for 15 minutes.
- **Inside n8n** — Executions, filter **Error**. Import the alert template, set `ALERT_WEBHOOK_URL`, activate it, then on each CoreEngine workflow open **Settings → Error workflow** and select **CoreEngine — failed execution alert**. n8n does not call that workflow unless the failing workflow points at it.

In-process jobs are still a timer in each BFF process. Run the scheduler on one process (`TASK_SCHEDULER_ENABLED=false` on the others).
