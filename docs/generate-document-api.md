# Generate Document API (contract)

Server-side DocEngine generation for automations / n8n / Flows.

**Status:** Phase 0 contract stub — **not production-ready**. Population/PDF rendering is not implemented in the BFF yet. REST returns **HTTP 501** with `code: DOCUMENTS_GENERATE_STUB`. Interactive DocEngine in the Vue UI works; use that until Phase 1/2 ship.

## Goal

Enable this pipeline without a browser session:

```text
Opportunity saved
  → Automations → Trigger flow (HTTP)
      → n8n
           1) generateDocument(opportunity, template)
           2) attach / use outputFileId
           3) send email
```

CoreEngine remains the only write path into Postgres. n8n orchestrates; it does not write `crm_schema` with a Postgres node.

## GraphQL mutation

```graphql
mutation GenerateDocument($input: GenerateDocumentInput!) {
  generateDocument(input: $input) {
    docValueId
    templateId
    templateSnapshotId
    collectionName
    recordId
    documentStatus
    outputFormat
    outputFileId
    downloadUrl
    values
  }
}
```

Auth: same as other BFF GraphQL mutations — `Authorization: Bearer` (user JWT or automation user). Prefer sending `X-CRM-Automation: n8n` on n8n → BFF calls.

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `collectionName` | `String` | yes | Entity api_name (e.g. `opportunity`) |
| `recordId` | `ID` | yes | Record id to fill the template from |
| `templateId` | `ID` | yes | `doc_template.id` |
| `outputFormat` | `String` | no | `pdf` (default) \| `html` |
| `documentStatus` | `String` | no | `completed` (default) \| `draft` |
| `persist` | `Boolean` | no | Default `true` — create/update `doc_value` |
| `renderOutput` | `Boolean` | no | Default `true` — build file + upload as `output_file` |
| `valuesOverride` | `JSON` | no | Merge/override mapped field values before save |
| `upsertMode` | `String` | no | `always_create` (default) \| `update_latest_draft` |

Naming matches automation / flow payloads (`collection` → `collectionName`, `recordId`). Internally `doc_value` still stores `parent_collection` / `parent_id`.

### Output

| Field | Type | Description |
|-------|------|-------------|
| `docValueId` | `ID` | Created/updated `doc_value.id` (null if `persist=false`) |
| `templateId` | `ID` | Template used |
| `templateSnapshotId` | `ID` | Pinned snapshot version |
| `collectionName` | `String` | Echo |
| `recordId` | `ID` | Echo |
| `documentStatus` | `String` | `draft` \| `completed` |
| `outputFormat` | `String` | `pdf` \| `html` |
| `outputFileId` | `ID` | Uploaded file id when `renderOutput=true` |
| `downloadUrl` | `String` | Short-lived download URL when available |
| `values` | `JSON` | Final mapped values written to `doc_value.values` |

### Errors

| Condition | Behavior |
|-----------|----------|
| Missing template / wrong collection | GraphQL error |
| Template not allowed for caller role | GraphQL error (403-style message) |
| Record not found | GraphQL error |
| Implementation not ready | GraphQL error: `generateDocument is not implemented yet` |

## REST (n8n-friendly)

Preferred for HTTP Request nodes — same body as GraphQL input:

```http
POST {{$env.BFF_URL}}/api/v1/documents/generate
Authorization: Bearer {{access_token}}
Content-Type: application/json
X-CRM-Automation: n8n

{
  "collectionName": "opportunity",
  "recordId": "{{$json.recordId}}",
  "templateId": "{{$env.OPPORTUNITY_QUOTE_TEMPLATE_ID}}",
  "outputFormat": "pdf",
  "documentStatus": "completed",
  "persist": true,
  "renderOutput": true
}
```

Response JSON matches `GenerateDocumentResult`.  
Phase 0 returns **HTTP 501** with `generateDocument is not implemented yet…` until Phase 1/2 land.

## n8n sketch (Opportunity doc)

1. Webhook receives automation payload (`collection`, `recordId`, `record`).
2. Login → Bearer token.
3. Optional: read related Account  
   `GET {{$env.BFF_URL}}/api/v1/account/{{$json.record.account_id}}`
4. Generate Opportunity document:

```http
POST {{$env.BFF_URL}}/api/v1/documents/generate
```

```json
{
  "collectionName": "opportunity",
  "recordId": "{{$json.recordId}}",
  "templateId": "{{$env.OPPORTUNITY_QUOTE_TEMPLATE_ID}}",
  "outputFormat": "pdf",
  "documentStatus": "completed",
  "valuesOverride": {
    "account_name": "{{$('Read Account').item.json.name}}"
  }
}
```

5. Email node: attach via `downloadUrl` or file id (Phase 2).
6. Optional: `PATCH /api/v1/opportunity/{{recordId}}` to stamp status / note.
## Implementation phases

### Phase 0 — contract (this doc + GraphQL stub)
- Schema types + `generateDocument` mutation registered
- Resolver throws not-implemented until Phase 1

### Phase 1 — populate + persist `doc_value`
- Load template (+ snapshot)
- Run field mapping against the record (port of client `buildPopulatedDocument` / `applyDocFieldMapping`)
- Create `doc_value` with `values`, `template_snapshot`, parent link (`parent_collection` / `parent_id`)
- Return `docValueId` + `values` (`renderOutput` may be ignored / false)

### Phase 2 — render + upload
- Render HTML or PDF from populated document (server DocEngine or headless HTML→PDF)
- Upload via existing files pipeline
- Set `doc_value.output_file`
- Return `outputFileId` + `downloadUrl`

### Phase 3 — attach helpers (optional)
- Optional `attachToRecordFiles: Boolean` to also add the file on a record files/M2M field
- Still leave **document and record email** to n8n. Platform mail (invite, reset, login code) is a separate BFF SMTP sender (`SMTP_*`), not this API.

## Non-goals

- Interactive DocFill UI
- List-report multi-record generation in v1 (separate input later)
- Sending document or record email from the BFF
- Replacing Form Builder **openDocument** actions

## Related

- Client populate: `src/modules/documents/services/docPopulation.ts`
- Client save: `src/modules/documents/services/docValueService.ts`
- Client export/upload: `src/modules/documents/services/docExportArtifact.ts`
- Flows: [`n8n-bff-flows.md`](./n8n-bff-flows.md)
