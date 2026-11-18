/**
 * Customer / vertical Block Layout registration (local only).
 *
 * Setup (once per deploy / workstation):
 *   cp src/extensions/register.local.example.ts src/extensions/register.local.ts
 *
 * `register.local.ts` is gitignored — CoreEngine upgrades will not overwrite it.
 * Do not put imports in the tracked `register.ts` host.
 *
 * @see docs/custom-blocks.md
 */

// Option A — sibling / private package:
// import '@acme/coreengine-clinic-blocks/register'

// Option B — register inline (still keep SFCs outside core when possible):
// import { registerCustomBlock } from '@/core/customBlocks/registry'
// import VitalsChartField from '../../../clinic-blocks/VitalsChartField.vue'
//
// registerCustomBlock({
//   component: 'ClinicVitalsChart',
//   fieldKey: 'vitals_chart',
//   label: 'Vital signs',
//   description: 'Chart vital signs for this visit',
//   render: VitalsChartField,
//   fullWidth: true,
//   icon: 'pi-heart',
// })
