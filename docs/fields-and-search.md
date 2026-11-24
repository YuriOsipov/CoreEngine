# Field types & list search

Setup → Object Manager field types for free text, and how the Messages (and other) list search box finds them. Live records on the **Supabase / Postgres** backend.

## String vs Text

| Setup type | Registry | Default length | Allowed length | Postgres column | Default UI |
|------------|----------|----------------|----------------|-----------------|------------|
| **String** | `STRING` | 255 | 1–255 | `varchar(n)` (new columns) | Text / Textarea / Picklist |
| **Text** | `TEXT` | 32 768 | 256–131 072 | `text` | Textarea |

- Length is stored as `options.maxLength` (and `length` mirror). The BFF enforces it on create/update when set.
- Legacy fields **without** `maxLength` stay unrestricted until re-saved in Setup.
- Existing plain `text` columns are **not** force-coerced to `varchar` (avoids breaking long values).
- **Text** cannot be Unique or btree-Indexed.

## List search (search box)

The list `search` query ORs several sources (cap 16 fields total):

| Source | Opt-in | Mechanism |
|--------|--------|-----------|
| Short **String** (and similar text scalars) | Setup → **Indexed** (`is_indexed`) | `ILIKE '%q%'` |
| **Text** | Setup → **Full-text search** (`options.fullTextSearch`) | Postgres FTS: `to_tsvector` + `plainto_tsquery` + **GIN** index |
| Lookups (M2O) | Setup → **Use in search** | Related Display Template `ILIKE` |

### Full-text search (Text)

- Checkbox **Full-text search** on Text fields writes `options.fullTextSearch: true` and optional `options.ftsConfig` (default `simple`; allowlisted configs such as `english`).
- DDL sync creates  
  `CREATE INDEX … USING GIN (to_tsvector(config, coalesce(col, '')))`.
- List search uses the **same expression** so the planner can use the GIN index.
- FTS is **word**-oriented (stemming / stop words depend on `ftsConfig`). Substring “contains” still belongs in list **filters** (`ILIKE`), not FTS.
- Field-level security: unreadable fields are excluded from search.

### Message Body (Sales pack)

`message.body` and `incoming_message.body` are seeded as **Text** with full-text search on. After upgrading an existing DB:

```bash
npm run platform:apply-pack -- sales
```

Then confirm schema sync created indexes such as `message_body_fts_idx` / `incoming_message_body_fts_idx`. The Messages list search box then matches Body via FTS.

## Related

- Capability overview: [`features.md`](./features.md)
- Sales messaging: [`../supabase/domains/sales/README.md`](../supabase/domains/sales/README.md)
- BFF list API `?search=`: [`../crm-bff/README.md`](../crm-bff/README.md)
