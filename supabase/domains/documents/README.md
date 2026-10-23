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

- List toolbar **Document report** fills a template from filtered / visible rows (`$payload.records`, `$payload.meta.filter`).
- For Tree layouts (e.g. Item Price by Item group), Field Mapping can use virtual roots:
  - `$payload.item_group_tree_rows` + nested `$children` (group header + price table per group)
  - `$payload.item_group_tree` / `$payload.item_group_tree_sections` as alternatives
- Preview (HTML/PDF) clones one section instance per group shell.
- Currency / Number interface formatting and Tree `main.sort` apply to nested price rows.
- Selecting a parent Item group includes nested child groups in the report payload.

## Apply

Applied automatically during `platform:provision` (after kernel, before the optional vertical pack).

```powershell
npm run platform:apply-pack -- documents
```
