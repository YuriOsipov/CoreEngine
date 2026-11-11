# Pricing domain pack

Catalog and promotion objects so seasonal / temporary discounts keep a full history.

Commercial Sales overview (CRM portal + this pack): [`../sales/README.md`](../sales/README.md).

## Includes

| Entity | Purpose |
|--------|---------|
| `item_group` | Catalog hierarchy |
| `item` | Product / service (`base_price`, `group`) |
| `price_group` | Price list / facility price group |
| `campaign` | Master marketing campaign (name, optional dates, description) |
| `promotion` | Dated rules under a campaign (fixed price or % off `item_price.price`) |
| `item_price` | List `price`, job-maintained `promo_price`, and applied `promotion` |

Roles: **Pricing Manager** (full CRUD on pack entities). Administrator comes from the kernel.

## Item Price Tree & Document reports

- Tree layout on **Item Price** groups rows by Item group; selecting a parent group (e.g. Hardware) loads that group **and all nested child groups**.
- List **Document report** can map a “Price list by Group” template via `$payload.item_group_tree_rows` / `$children` (see Documents pack).
- Within-group Item order uses Tree **`main.sort`**; prices render with the Currency interface in documents.

## Hierarchy

`Campaign` → many `Promotion` → sync writes the winning promotion onto `item_price`.

- Sync uses **Promotion** `date_start` / `date_end` (not Campaign dates).
- Scope is an **AND** of every filled filter on the promotion: `item`, `item_group`, and `price_group`. Example: Item group = Cosmetic and Price group = Diller updates only Cosmetic items in the Diller price list (not Retail / Wholesale).
- While a promotion matches: set `promo_price` and `promotion`.
- When `Promotion.date_end` is past or there is no winner: clear `promotion` and set `promo_price = price`.

### Default dates from Campaign

When creating a Promotion from a Campaign related list, Object Manager field settings can prefill dates:

| Promotion field | Default from parent field |
|-----------------|---------------------------|
| Date start (`date_start`) | `date_start` |
| Date end (`date_end`) | `date_end` |

In Setup → Object Manager → Promotion → Fields & Relationships, edit each date field and set **Default from parent field** to the matching Campaign API name (leave **Default Value** as None). Values apply only when creating a new Promotion from a Campaign related list (not when editing); they remain editable.

## Apply

```powershell
npm run platform:provision -- --domain pricing
```

Or after kernel-only provision:

```powershell
npm run platform:apply-pack -- pricing
```

After apply, create a scheduled task with job type **Sync promo prices** (hourly recommended) so `promo_price` and `promotion` stay current. Related-transfer lookups can keep using `price` or switch `valueField` to `promo_price` in Setup — pack does not change existing mappings.

## Export

```powershell
npm run platform:export-pack -- pricing
```
