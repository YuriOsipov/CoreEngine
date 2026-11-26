# Docs

Active product/ops docs belong here.

- [Features & capability overview](./features.md)
- [Fields & list search](./fields-and-search.md) — String vs Text, Indexed vs Postgres full-text (GIN)
- [Vertical domain packs](./domain-packs.md) — shipped packs, industry matrix, apply/export, fork guide
- [Security model](./security.md) — auth, ACL, FLS, owner RLS, deployment checklist
- [MCP server](./mcp.md) — Claude/Cursor tools for schema, packs, records (`/api/v1/mcp`)
- [Setup & development](./setup.md) — Docker, local npm, env, scripts, CI |
- [OIDC SSO](./oidc-sso.md) — external IdP (Keycloak, Auth0, Entra, …)
- [n8n ↔ BFF flows](./n8n-bff-flows.md) — webhook trigger + GraphQL write-back (`target=n8n` → `/webhook/ce-{key}`; `target=activepieces` → `/api/v1/webhooks/{flowId}`)
- [n8n templates](./n8n/README.md) — Docker profile `automation`, pack keys, quote/reminder write-back, failed-execution alert
- [Activepieces (MIT)](./activepieces/README.md) — alternative orchestrator; Setup → Connections Destination **Your Activepieces**; headless import via `npm run registry:seed-activepieces-flows` (project variables, no Platform API keys)
- [Backup and restore](./backup-restore.md)
- [Upgrading](./upgrading.md)
- [Generate Document API](./generate-document-api.md) — server DocEngine contract for automations / n8n
- [Custom blocks](./custom-blocks.md) — `registerCustomBlock`

Record automations live in Setup → Object Manager → Automations (`backend_config.automations`). Scheduled tasks live in Setup → Tasks.

Historical Directus cutover notes live under `archive/` (not current runbooks).
