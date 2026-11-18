# Docs

Active product/ops docs belong here.

- [n8n ↔ BFF flows](./n8n-bff-flows.md) — webhook trigger + GraphQL write-back (`target=n8n` → `/webhook/ce-{key}`)
- [n8n templates](./n8n/README.md) — Docker profile `automation`, pack keys, quote/reminder write-back, failed-execution alert
- [Backup and restore](./backup-restore.md)
- [Upgrading](./upgrading.md) — includes failed-run monitoring notes via Setup / n8n
- [Generate Document API](./generate-document-api.md) — server DocEngine contract for automations / n8n (`generateDocument`)
- Record automations — Setup → Object Manager → Automations (`backend_config.automations`); applied on create/update in the BFF after formulas
- Scheduled tasks live in Setup → Tasks. `send_notification` jobs call `app_flow_triggers` (n8n `http` handler). Slot generation and schema verification run inside the BFF.

Historical Directus cutover notes live under `archive/` (not current runbooks).
