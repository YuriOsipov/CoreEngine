# n8n templates

Import these into n8n (**Workflows → Import from file**). They stay inactive until you add env and activate them.

CoreEngine stays the only write path into Postgres. Do not add a Postgres node aimed at `crm_schema`.

| Template | When to use |
|----------|-------------|
| [`crm-bff-flow.workflow.json`](./crm-bff-flow.workflow.json) | Webhook from a flow key → login → GraphQL `updateRecord` (writes `note`) |
| [`record-rest-patch.workflow.json`](./record-rest-patch.workflow.json) | Same webhook → REST `PATCH /api/v1/:collection/:id` |
| [`generate-opportunity-document.workflow.json`](./generate-opportunity-document.workflow.json) | Record automation → `POST /api/v1/documents/generate` (PDF) |
| [`upsert-by-external-id.workflow.json`](./upsert-by-external-id.workflow.json) | Another system posts `{ external_id, name, phone }` → upsert |
| [`failed-execution-alert.workflow.json`](./failed-execution-alert.workflow.json) | n8n Error Trigger → POST a JSON alert when a linked workflow fails |

Runbook (payload shape, auth, loop avoidance): [`../n8n-bff-flows.md`](../n8n-bff-flows.md). Document generate contract: [`../generate-document-api.md`](../generate-document-api.md).

## Env on the n8n process

| Variable | Used by |
|----------|---------|
| `BFF_URL` | All write/read templates. From Docker n8n, often `http://host.docker.internal:4000` |
| `N8N_WEBHOOK_SECRET` | Same value as the BFF. Checked on CoreEngine → n8n webhooks |
| `CRM_N8N_EMAIL` / `CRM_N8N_PASSWORD` | From `npm run registry:seed-n8n-automation-user` |
| `CRM_PATCH_FIELD` / `CRM_PATCH_VALUE` | REST patch template (default field `note`) |
| `OPPORTUNITY_QUOTE_TEMPLATE_ID` | Document template |
| `N8N_INBOUND_SECRET` | Header `X-CRM-Inbound-Secret` on the upsert webhook |
| `CRM_UPSERT_COLLECTION` / `CRM_UPSERT_BY` | Default `account` / `external_id` (field must be unique) |
| `ALERT_WEBHOOK_URL` | Failed-execution alert (Slack incoming webhook or any JSON POST) |

## Wire a CoreEngine flow key

1. Import a webhook template and activate it.
2. Copy the **production** webhook URL into the flow’s HTTP URL (Setup → Flows), or into `N8N_WEBHOOK_URL` and run `npm run registry:seed-n8n-flow-trigger` for the seeded key.
3. Put that flow key on the automation (Setup → Object Manager → Automations → Trigger flow).

## Failed runs

Two places, on purpose:

- **Inside CoreEngine** — Setup → Flows → **Failed runs** (outbound `runLocalFlow` errors, kept 90 days). Setup → Tasks → **Failed runs** (scheduled jobs with status `FAILED`). Per-task **History** is still there.
- **Optional admin email** — Setup → General → **Failed-run alerts** (needs `SMTP_HOST` / `SMTP_FROM`). Or set `FAILED_RUN_NOTIFY_EMAIL` / `FAILED_RUN_NOTIFY=true`. Same flow/task key is not emailed again for 15 minutes.
- **Inside n8n** — Executions, filter **Error**. Import the alert template, set `ALERT_WEBHOOK_URL`, activate it, then on each CoreEngine workflow open **Settings → Error workflow** and select **CoreEngine — failed execution alert**. n8n does not call that workflow unless the failing workflow points at it.

In-process jobs are still a timer in each BFF process. Run the scheduler on one process (`TASK_SCHEDULER_ENABLED=false` on the others).
