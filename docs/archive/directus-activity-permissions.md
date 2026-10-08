# Directus Activity & Revisions Permissions

The CRM **Activity history** layout component (`CrmActivityLog`) reads accountability data from Directus system collections:

- `directus_activity` — who performed an action, when, and on which collection/item
- `directus_revisions` — revision snapshots used to compute field-level diffs

Reference: [Directus Accountability](https://directus.com/docs/guides/auth/accountability)

## Automatic bootstrap (recommended)

On app startup, Directus activity/revision ACL used to be provisioned by
`ensureAppCollections.ts`. That bootstrap is **removed** — audit now goes through
the BFF GraphQL (`recordActivities` / `recordRevisions`) backed by Supabase.

Each permission includes an item filter so users only see accountability for CRM collections:

```json
{
  "collection": {
    "_nstarts_with": "directus_"
  }
}
```

Allowed fields:

| Collection | Read fields |
|------------|-------------|
| `directus_activity` | `id`, `action`, `timestamp`, `collection`, `item`, `user`, `revisions` |
| `directus_revisions` | `id`, `data`, `parent`, `collection`, `item` |

The bootstrap is idempotent — existing permissions are not duplicated. Check the browser console on first load for `activityPermissionsCreated` in the bootstrap result (via dev logging if enabled).

**Note:** If `VITE_DIRECTUS_TOKEN` is set in `.env`, the frontend uses a static admin token and bypasses role permissions during development. Remove it to test real CRM user access.

## Task assignment (`directus_users`)

On app startup, [`ensureAppCollections.ts`](../src/core/ensureAppCollections.ts) also:

1. Grants **read** on `directus_users` (`id`, `first_name`, `last_name`, `email`) for every app/admin policy — required for user pickers and M2O labels.
2. Creates `os_tasks.assigned_to` (M2O → `directus_users`) when the `os_tasks` collection exists and the field is missing.

The frontend loads users via the Directus **`/users`** system endpoint (`readUsers` / `readUser`), not `/items/directus_users`, which is blocked for system collections.

### Add assignee to the task detail layout

After bootstrap, expose the field on record pages:

1. Open **Config → Form Builder** for `os_tasks`
2. Drag **Assigned To** (`assigned_to`) onto the detail layout
3. Save the layout to `Setting`

The field renders as `CrmAutoComplete` with `relatedCollection: 'directus_users'`. System collections cannot be created from the picker ("New directus_users" is suppressed).

### Manual fallback (permissions)

If bootstrap fails, add **Read** on `directus_users` for each CRM policy with fields: `id`, `first_name`, `last_name`, `email`.

## Prerequisites

1. **Enable accountability** on each CRM collection that should be audited.
   - In Directus: *Settings → Data Model → Collection → Accountability* → **Track all activity**
   - App collections (`Setting`, `user_setting`, `recent_record_views`) are provisioned with accountability in `ensureAppCollections.ts`
   - Verify the same for business collections (`os_projects`, `os_tasks`, etc.)

2. **Ensure changes go through Directus** — activity is not recorded for direct database edits.

## Manual setup (fallback)

If automatic bootstrap fails (e.g. bootstrap token lacks permission to create permissions):

1. Open **Settings → Access Control**
2. Select each CRM policy used by record viewers
3. Add **Read** on `directus_activity` and `directus_revisions`
4. Apply the collection filter above (or an explicit `_in` list of CRM collection slugs)
5. Grant the field lists from the table above

## How diffs are computed

The CRM:

1. Loads activities via `/activity` for the current record
2. Loads all revisions for the same record via `/revisions`
3. Compares each update revision’s `data` to its **previous revision** in the chain

When Directus returns `parent: null` on revisions (common on some instances), the app falls back to the **previous revision by sorted `id`** for the same record — matching Directus admin **Show Differences Only**.

Only fields whose values actually changed are shown, with **old → new** formatting.

## Security notes

- **Collection filter vs item filter:** Permissions restrict activity by *collection name*, not individual record ID.
- **Stricter RBAC:** If users can read only a subset of records in a collection, consider a custom Directus endpoint that verifies `readItem` before returning activity.
- **Read-only by design:** The frontend never creates or updates activity/revisions.

## Verification

After bootstrap or manual setup:

```http
GET /permissions?filter[collection][_eq]=directus_revisions&fields=policy,collection,action,fields
```

Expect read rows for your app-access policies.

For a known record (example):

```http
GET /revisions?filter[collection][_eq]=os_projects&filter[item][_eq]={recordId}&fields=id,data,parent&sort=id
GET /activity?filter[collection][_eq]=os_projects&filter[item][_eq]={recordId}&fields=id,action,timestamp,revisions.id&sort=-timestamp
```

On the record detail page, an update should list only changed fields (e.g. Status and Start Date), not the full record payload.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Empty history for edited records | Collection accountability disabled |
| Permission / 403 warning | Bootstrap failed or role lacks read on activity/revisions |
| “Record updated” with no field list | `/revisions` blocked, or no prior revision in chain |
| Wrong fields listed as changed | Report as bug — raw `delta` fallback is intentionally not used |
| Activity exists in Directus admin but not in CRM | Permission filter excludes the collection slug |
