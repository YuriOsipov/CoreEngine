# Docs

Active product/ops docs belong here.

- [n8n ↔ BFF flows](./n8n-bff-flows.md) — webhook trigger + GraphQL write-back
- Record automations — Setup → Object Manager → Automations (`backend_config.automations`); applied on create/update in the BFF after formulas
- Scheduled tasks live in Setup → Tasks. `send_notification` jobs call `app_flow_triggers` (n8n `http` handler). Slot generation and schema verification run inside the BFF.

Historical Directus cutover notes live under `archive/` (not current runbooks).
