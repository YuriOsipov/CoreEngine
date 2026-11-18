# Custom Block Layout slots

How to add vertical UI (charts, scanners, quote strips) **without** forking forever into CoreEngine core.

## Who does what

| Who | Role |
|-----|------|
| **CoreEngine maintainers** | Ship built-in blocks (`Files`, `CrmDocEngine`, `CrmScheduler`, `CrmTreeTable`, …) and the registry host |
| **Vertical / customer engineers** | Own Vue SFCs in a **separate package or sibling repo**; call `registerCustomBlock` at bootstrap |
| **App Admin** | Places and configures blocks on Block Layouts in Setup → Form / Record Page builder |
| **External marketplace partner** | Not supported yet (would need a sandboxed SDK later) |

Admin never uploads arbitrary code. Engineers register components; Admin only drops them onto layouts.

## Why not put customer SFCs in CoreEngine source?

Merging every customer `VitalsChart.vue` into this monorepo makes **CoreEngine upgrades** painful (conflicts, re-tests, shared release cadence). Prefer:

```text
coreEngine/                    ← upgrade this (tracked)
  src/extensions/register.ts   ← stable host only (do not put customer imports here)
  src/extensions/register.local.ts  ← gitignored; your imports live here
  sibling/ or npm:
    acme-clinic-blocks/        ← your SFCs + registerCustomBlock()
domain packs JSON              ← layouts that reference component: "ClinicVitalsChart"
```

Same idea as the public **DocEngine** sibling: CoreEngine hosts the slot; the specialized UI can version separately. Never edit the tracked `register.ts` for customer wiring — the next CoreEngine update would overwrite it.

## Built-in vs extension

| Kind | Lives in | Upgrade story |
|------|----------|----------------|
| Built-in palette blocks | CoreEngine (`FormBuilder` + renderers) | Comes with CoreEngine releases |
| Extension blocks | Your package → `registerCustomBlock` | You bump CoreEngine; re-test your package against the registry API |

## Register an extension block

```ts
// acme-clinic-blocks/src/register.ts
import { registerCustomBlock } from 'coreengine/custom-blocks' // or relative import in a monorepo overlay
import VitalsChartField from './VitalsChartField.vue'

registerCustomBlock({
  component: 'ClinicVitalsChart', // stored in layout JSON
  fieldKey: 'vitals_chart',
  label: 'Vital signs',
  description: 'Chart vital signs for this visit',
  render: VitalsChartField,
  fullWidth: true,
  icon: 'pi-heart',
})
```

Wire once per workstation / deploy (gitignored local file):

```bash
cp src/extensions/register.local.example.ts src/extensions/register.local.ts
```

In `register.local.ts`, import your package (e.g. `import '@acme/coreengine-clinic-blocks/register'`).  
`main.ts` always imports the tracked host [`src/extensions/register.ts`](../src/extensions/register.ts), which loads `register.local.ts` via Vite `import.meta.glob` when that file exists. Clean clones and CI without a local file still build.

### SFC contract

Your component should accept:

| Prop | Type | Notes |
|------|------|--------|
| `field` | layout field metadata | Includes any settings you stored on the field |
| `collection` | `string` | Parent entity api_name |
| `recordId` | `string \| number` | Parent record id |
| `modelValue` | record object (optional) | Edit layouts |
| `readonly` | `boolean` (optional) | |
| `active` | `boolean` (optional) | False when the group is collapsed |

Use GraphQL bridges / BFF APIs like the rest of the app. Use `t()` for UI strings. Prefer OpenVue components.

### Layout JSON (what Admin saves / packs export)

```json
{
  "id": "fld_vitals_1",
  "span": 12,
  "field": "vitals_chart",
  "label": "Vital signs",
  "component": "ClinicVitalsChart"
}
```

App Admin configures placement in Setup; export with `platform:export-pack` if you seed layouts.

## API (host)

| Function | Purpose |
|----------|---------|
| `registerCustomBlock(def)` | Register / replace a block |
| `listCustomBlocks()` | Palette merge |
| `getCustomBlock(component)` | Lookup |
| `isRegisteredCustomBlock(field)` | Detector |
| `resolveCustomBlockRender(field)` | Runtime `<component :is>` |

Source: [`src/core/customBlocks/registry.ts`](../src/core/customBlocks/registry.ts).

## What this is not

- Not a Twenty-style sandboxed partner SDK (`defineFrontComponent` + CLI publish).
- Not App Admin uploading Vue from the browser.
- Not a replacement for **domain packs** (entities, roles, layouts as JSON) — packs still configure *which* blocks appear where after you ship the SFC.

## When to revisit a full SDK

Only if external ISVs must ship UI **without** a private package import into your deployment. Until then, **registry + sibling package** keeps upgrades manageable for SMB / mid-market.
