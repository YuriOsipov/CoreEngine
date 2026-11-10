# Documents domain pack

Platform document-engine objects used by Setup → Document Templates and runtime DocEngine fills.

## Includes

| Entity | Purpose |
|--------|---------|
| `doc_template` | Template head (body, mapping, role scope) |
| `doc_template_snapshot` | Immutable template versions |
| `doc_value` | Filled documents linked to a parent record |
| `doc_value_set` | Reusable answer sets per template |

These objects are hidden from Object Manager day-to-day pickers and excluded from the role permission matrix (admins / document APIs use them directly).

## List reports & Tree mapping

- List toolbar **Price list report** fills a template from filtered / visible rows (`$payload.records`, `$payload.meta.filter`).
- For Tree layouts (e.g. Item Price by Item group), Field Mapping can use virtual roots:
  - `$payload.item_group_tree_rows` + nested `$children` (group header + price table per group)
  - `$payload.item_group_tree` / `$payload.item_group_tree_sections` as alternatives
- Preview (HTML/PDF) clones one section instance per group shell.
- Currency / Number interface formatting and Tree `main.sort` apply to nested price rows.
- Selecting a parent Item group includes nested child groups in the report payload.

## Outbound flows (platform)

Record Automations can call an external HTTP webhook after create/update/delete via **Trigger flow**. Mapping is configured in the UI (not by pasting a raw URL into the automation).

### Setup → Flows

1. Open **Setup → Flows** (`/setup/flows`).
2. **New flow** (or edit an existing key):
   - **Flow key** — e.g. `test_hook` (this is what Automations use)
   - **Handler** — `HTTP (external URL)`
   - **External URL** — e.g. `https://integrations.eclouds.co:8445/api2/test_hook`
   - **HTTP method** — usually `POST`
   - **Authentication** (optional):
     | Type | Outbound header |
     |------|-----------------|
     | None | No auth header |
     | Bearer token | `Authorization: Bearer …` |
     | API key header | Custom header (default `X-API-Key`) |
     | Basic auth | `Authorization: Basic …` |
   - **Enabled** — on
3. Save.

Rows live in `public.app_flow_triggers` (`handler=http`, `config.url` / `config.auth`). Outbound calls also send `X-CRM-Source: bff-flow` and, when set, `X-CRM-Flow-Secret` from env `N8N_WEBHOOK_SECRET`.

### Automations → Trigger flow

1. **Setup → Object Manager** → choose an object → **Automations**.
2. Add/edit a rule → **Actions** → **Add flow**.
3. Enter the **flow key** (e.g. `test_hook`), not the external URL.
4. Apply. After a matching create/update/delete commits, the BFF runs `runLocalFlow(key)` and POSTs a payload like:

```json
{
  "source": "record_automation",
  "trigger": "create",
  "collection": "account",
  "recordId": "...",
  "record": {},
  "before": null,
  "automation": { "id": "...", "name": "..." }
}
```

See also: [`docs/n8n-bff-flows.md`](../../../docs/n8n-bff-flows.md).

### Generate Document API (server)

Server-side DocEngine generation for automations / n8n (no browser session). Full contract: [`docs/generate-document-api.md`](../../../docs/generate-document-api.md).

**Intended pipeline**

```text
Opportunity saved
  → Automations → Trigger flow (HTTP)
      → n8n
           1) POST /api/v1/documents/generate
           2) use outputFileId / downloadUrl
           3) send email (n8n SMTP / provider)
```

**REST (preferred for n8n)**

```http
POST /api/v1/documents/generate
Authorization: Bearer <token>
Content-Type: application/json

{
  "collectionName": "opportunity",
  "recordId": "...",
  "templateId": "...",
  "outputFormat": "pdf",
  "documentStatus": "completed"
}
```

GraphQL equivalent: `mutation { generateDocument(input: …) { … } }`

**Input (summary)**

| Field | Required | Notes |
|-------|----------|--------|
| `collectionName` | yes | Entity api_name, e.g. `opportunity` (maps from automation `collection`) |
| `recordId` | yes | Record id (same as automation `recordId`) |
| `templateId` | yes | `doc_template.id` |
| `outputFormat` | no | `pdf` (default) \| `html` |
| `documentStatus` | no | `completed` (default) \| `draft` |
| `persist` | no | Default `true` — create/update `doc_value` |
| `renderOutput` | no | Default `true` — upload file as `output_file` (Phase 2) |
| `valuesOverride` | no | Merge/override mapped values |
| `upsertMode` | no | `always_create` (default) \| `update_latest_draft` |

**Phases**

| Phase | Status | Delivers |
|-------|--------|----------|
| 0 | Done | Contract + GraphQL stub (`generateDocument` validates, then not-implemented) |
| 1 | Planned | Populate field mapping + persist `doc_value` |
| 2 | Planned | PDF/HTML render + `output_file` upload + `downloadUrl` |
| 3 | Optional | Attach to parent files field; email stays in n8n |

Auth: Bearer JWT (automation user). Prefer `X-CRM-Automation: n8n` on n8n → BFF calls.

## Apply

Applied automatically during `platform:provision` (after kernel, before the optional vertical pack).

```powershell
npm run platform:apply-pack -- documents
```
