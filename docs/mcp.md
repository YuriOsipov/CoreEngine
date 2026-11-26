# MCP server (CoreEngine)

CoreEngine exposes a **Model Context Protocol** server on the BFF so Claude, Cursor, Codex, and other MCP clients can administer schema, layouts, domain packs, and records through the same ACL / FLS / audit path as Setup GraphQL.

## Enable

```env
MCP_HTTP_ENABLED=true
```

Restart the BFF. Endpoint:

```text
http://localhost:4000/api/v1/mcp
```

Off by default. Production: enable only when you intend external MCP clients to reach the BFF, terminate TLS at the proxy, and keep `CORS_ORIGIN` tight.

## Auth

Send a CoreEngine **admin or operator** access token:

```http
Authorization: Bearer <access_token>
```

Obtain a token via `POST /auth/login` (local) or your usual SSO → session bridge. Admin tools require DB admin (`adminAccess` / role admin). Record tools use the caller’s object ACL, FLS, and owner RLS.

OIDC IdP access tokens via JWKS are **not** accepted yet — see [oidc-sso.md](./oidc-sso.md).

## Cursor example

`.cursor/mcp.json` (project) or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "coreengine": {
      "url": "http://127.0.0.1:4000/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_TOKEN"
      }
    }
  }
}
```

Refresh the Bearer when the 15-minute access token expires:

```powershell
.\scripts\refresh-cursor-mcp.ps1
```

That rewrites local `.cursor/mcp.json` (gitignored). Reload MCP in Cursor after refreshing.

## Tool catalog

### Setup & maintenance (admin)

| Tool | Purpose |
|------|---------|
| `list_objects` | List business objects |
| `inspect_schema` | Fields, relations, sensitivity, role layouts |
| `upsert_object_schema` | Create object / upsert fields (incl. PII sensitivity 0–2) |
| `update_role_layout` | Upsert role-scoped Block / Record / list layout |
| `export_domain_pack` | Return pack-shaped JSON (no disk write) |
| `validate_domain_pack` | Validate pack JSON shape |
| `inspect_flow_logs` | Recent failed Connection dispatches |

### Operations (operator)

| Tool | Purpose |
|------|---------|
| `query_records` | List / get records |
| `create_record` | Create record |
| `update_record` | Patch fields; `owner_id` = Change Owner |
| `retry_message` | Re-dispatch Message via Connection (`confirm: true`) |

## Domain packs

`export_domain_pack` returns JSON for Git. Prefer committing with:

```bash
npm run platform:export-pack -- sales
```

That CLI uses the same builder as MCP. There is **no** MCP `apply_domain_pack` — apply via `platform:apply-pack` / provision.

## Security notes

- Tools call existing BFF services; Setup changes append to `config_audits`.
- `retry_message` requires `confirm: true`.
- Secrets (JWT secret, webhook secrets, Activepieces keys) are never returned by tools.
- Prefer a dedicated admin token on trusted workstations; revoke by rotating password / refresh reuse.

## Related

- [Security model](./security.md)
- [Domain packs](./domain-packs.md)
- [OIDC SSO](./oidc-sso.md)
