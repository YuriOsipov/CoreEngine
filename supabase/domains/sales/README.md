# Sales domain pack

Minimum Sales portal configuration on top of the Helix platform kernel.

## Includes

| Entity | Purpose |
|--------|---------|
| `account` | Company / customer |
| `contact` | People linked to accounts |
| `opportunity` | Pipeline deals |
| `quote` | Quotes linked to opportunities |

Roles: **Sales Rep**, **Sales Manager** (full CRUD on pack entities). Administrator comes from the kernel.

Opportunity ships with a **Record Page** layout (`groupKey: RecordPage`) that includes a **Path** component bound to open stages on `stage` and closed outcomes on `outcome` (Won / Lost / Cancelled).

## Apply

```powershell
npm run platform:provision -- -Domain sales
```

Or after kernel-only provision:

```powershell
npm run platform:apply-pack -- sales
```

## Export (persist Setup edits)

After changing fields, layouts, or seeded records in the UI:

```powershell
npm run platform:export-pack -- sales
```

Then commit the updated files under this folder.
