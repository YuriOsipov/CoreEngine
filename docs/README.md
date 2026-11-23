# Docs

Active product/ops docs belong here.

- [Features & capability overview](./features.md)
- [Security model](./security.md) — auth, ACL, FLS, owner RLS, deployment checklist
- [Setup & development](./setup.md) — Docker, local npm, env, scripts, CI
- [OIDC SSO](./oidc-sso.md) — external IdP (Keycloak, Auth0, Entra, …)
- [n8n ↔ BFF flows](./n8n-bff-flows.md) — webhook trigger + GraphQL write-back (`target=n8n` → `/webhook/ce-{key}`)
- [n8n templates](./n8n/README.md) — Docker profile `automation`, pack keys, quote/reminder write-back, failed-execution alert
- [Backup and restore](./backup-restore.md)
- [Upgrading](./upgrading.md)
- [Generate Document API](./generate-document-api.md) — server DocEngine contract for automations / n8n
- [Custom blocks](./custom-blocks.md) — `registerCustomBlock`

Record automations live in Setup → Object Manager → Automations (`backend_config.automations`). Scheduled tasks live in Setup → Tasks.

Historical Directus cutover notes live under `archive/` (not current runbooks).
