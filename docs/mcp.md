# MCP server (CoreEngine)

CoreEngine exposes a **Model Context Protocol** server on the BFF so Claude, Cursor, Codex, and other MCP clients can administer schema, layouts, domain packs, and records through the **same records facade** as GraphQL/REST (object ACL, FLS including dotted-key filters/sorts/search, owner RLS, audit).

## Enable

```env
MCP_HTTP_ENABLED=true
# Schema/layout write tools (upsert_object_schema, update_role_layout) — default off
# MCP_SCHEMA_WRITE_ENABLED=false
# Per-user MCP HTTP calls / minute (default 120) — in-process per BFF instance
# MCP_RATE_LIMIT_PER_MIN=120
# Cap for query_records limit (default 50, max 200)
# MCP_QUERY_MAX_LIMIT=50
```

Restart the BFF. Endpoint:

```text
http://localhost:4000/api/v1/mcp
```

Off by default. Production: enable only when you intend external MCP clients to reach the BFF, terminate TLS at the proxy, and keep `CORS_ORIGIN` tight.

**Transport:** `http://127.0.0.1` / `localhost` is fine for local development. Any non-local MCP endpoint **must** be **HTTPS**. Never send the credential over plain HTTP outside loopback.

## Auth — dedicated MCP credentials

`/api/v1/mcp` accepts **only** opaque MCP credentials (`ce_mcp_…`), not the browser web-session JWT or refresh token. Sharing the web session would risk refresh-reuse revocation and lockouts when two clients race.

Create a credential in the UI:

1. Sign in as an admin (local login or SSO).
2. Open **Setup → MCP → Create credential**.
3. Choose a label, scopes (`read` default; optional `write` / `schema`), and expiry (1 hour–30 days).
4. Copy the token **once** into the MCP client. It is never listed again (only the hash is stored).
5. Revoke anytime from the same page.

```http
Authorization: Bearer ce_mcp_…
```

Admin tools still require DB admin (`adminAccess` / role admin) on the credential’s user. Record tools use that user’s object ACL, FLS, and owner RLS. Credential scopes gate tools further (`read` ⊂ `write` ⊂ `schema`).

OIDC IdP access tokens via JWKS are **not** accepted. See [oidc-sso.md](./oidc-sso.md).

### Scopes

| Scope | Tools |
|-------|--------|
| `read` | list/inspect/export/validate, `query_records`, `inspect_flow_logs` |
| `write` | `create_record`, `update_record`, `retry_message` (+ read) |
| `schema` | `upsert_object_schema`, `update_role_layout` (+ write/read) |

`schema` tools also require `MCP_SCHEMA_WRITE_ENABLED=true`. That env flag is **coarse** (all admins with a `schema`-scoped credential) — fine for a pilot; prefer short TTL + least privilege until per-user server-side approval exists.

### Local login helper script

With local login enabled, you can mint a short-lived credential from the CLI:

```powershell
.\scripts\refresh-cursor-mcp.ps1
```

That logs in, `POST /api/v1/mcp/credentials`, and writes the `ce_mcp_…` token into local `.cursor/mcp.json` (**gitignored**). Reload MCP in Cursor after refreshing. SSO-only deployments use Setup → MCP instead (the script needs `POST /auth/login`).

## Cursor example

`.cursor/mcp.json` (project) or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "coreengine": {
      "url": "http://127.0.0.1:4000/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer ce_mcp_YOUR_TOKEN"
      }
    }
  }
}
```

For a remote BFF use `https://…` only. Never put MCP tokens in tickets, chats, or committed files.

## Tool catalog

### Setup & maintenance (admin)

| Tool | Purpose |
|------|---------|
| `list_objects` | List business objects |
| `inspect_schema` | Fields, relations, sensitivity, role layouts |
| `upsert_object_schema` | Request object/field upsert — **`schema` scope + `MCP_SCHEMA_WRITE_ENABLED`**; **queues for Setup → MCP approval** |
| `update_role_layout` | Request role layout upsert — same gates; **queues for approval** |
| `export_domain_pack` | Return pack-shaped JSON (no disk write) |
| `validate_domain_pack` | Validate pack JSON shape |
| `inspect_flow_logs` | Recent failed External Flow dispatches (**admin**; request bodies omitted) |

### Records & operations (authenticated user)

| Tool | Purpose |
|------|---------|
| `query_records` | List / get records (facade FLS; row cap `MCP_QUERY_MAX_LIMIT`) |
| `create_record` | Create record |
| `update_record` | Patch fields; `owner_id` = Change Owner |
| `retry_message` | Request Message re-dispatch via External Flow — **queues for Setup → MCP approval** |

**Roles:** tools that change Setup schema/layouts/packs/flow logs require **admin**. Record tools require any authenticated app user (object ACL still applies). There is no separate “operator” role — that word in older docs meant “authenticated user”.

## Domain packs

`export_domain_pack` returns JSON for Git. Prefer committing with:

```bash
npm run platform:export-pack -- sales
```

That CLI uses the same builder as MCP. There is **no** MCP `apply_domain_pack` — apply via `platform:apply-pack` / provision.

## Security notes

### Same path as GraphQL (FLS)

Record tools call `findManyRecords` / `findOneRecord` / `createRecord` / `updateRecord` with `{ me }`. That runs `assertReadableQuery` (filters, sorts, dotted keys), owner RLS, and `redactRecordForMe` on results — the same stack as GraphQL. Covered by `crm-bff/src/mcp/tools/records.fls.test.ts` (dotted-key filters, restricted sorts, related search forwarding, redaction; aggregates/documents absent from the tool catalog). Run `node scripts/audit-backend.mjs` so `/api/v1/mcp` is discovered via `app.route` and classified (auth-only allowlisted). Aggregates / document payloads are **not** MCP tools.

### Human approval (pending actions)

`retry_message`, `upsert_object_schema`, and `update_role_layout` **do not run immediately**. They insert a row into `app_mcp_pending_actions` and return `{ status: "pending_approval", pendingActionId, … }`. A human admin must **Approve** or **Reject** under **Setup → MCP**. Approval re-checks ACL and executes as the **original requester** (not the approving admin).

A model-set boolean is **not** approval. Prompt injection cannot bypass the UI decision.

Enqueue still requires:

- Authenticated MCP credential with the right scope (`write` / `schema`)
- For schema tools: `MCP_SCHEMA_WRITE_ENABLED=true`
- For `retry_message`: Update ACL on the Message at enqueue time (re-checked on approve)

### Admin schema writes are high-risk

`upsert_object_schema` and `update_role_layout` can change who sees what. Enqueue stays **disabled** until `MCP_SCHEMA_WRITE_ENABLED=true`, the credential must include `schema`, and a human must approve the pending action. Prefer short-lived credentials; keep day-to-day MCP on `read`.

### Flow logs / PII

`inspect_flow_logs` is **admin-only**. Responses **omit `requestBody`** and re-sanitize error text (URLs / credential-like substrings). Use Setup → External Flows for full request bodies when debugging.

### Rate limits

Each authenticated MCP HTTP request consumes a **per-user, in-process fixed window** (`MCP_RATE_LIMIT_PER_MIN`, default **120**/min). Over limit → **429** + `Retry-After`. `query_records` also caps `limit` at `MCP_QUERY_MAX_LIMIT` (default **50**).

**Multi-instance:** the counter is not shared across BFF processes — *N* instances effectively allow about *N×* the configured limit until a shared store backs it. Plan capacity accordingly.

### Audit attribution

- Creating/revoking MCP credentials and approving/rejecting pending actions write `config_audits` (`mcp_credential:…` / `mcp_pending:…`).
- Config changes from executed MCP tools use summaries prefixed with `MCP … (approved)`.
- Record create/update and approved `retry_message` set activity `comment` to `mcp:…` so trails distinguish assistant-driven changes from the UI.

### Secrets

JWT secret, webhook secrets, Activepieces keys, sealed flow auth, and MCP token plaintext (after create) are never returned by tools or list APIs.

## Related

- [Security model](./security.md)
- [Domain packs](./domain-packs.md)
- [OIDC SSO](./oidc-sso.md)
