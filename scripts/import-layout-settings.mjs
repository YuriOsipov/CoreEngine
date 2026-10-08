/**
 * Retired: one-shot Setting → layout_settings import.
 *
 * Layouts already live in public.layout_settings. Edit via the Vue builders
 * / GraphQL layoutSettings APIs going forward.
 */
console.error(
  [
    'registry:import-layouts was retired.',
    'Legacy Setting import is no longer part of the live cutover path.',
    'Layouts are owned by public.layout_settings + GraphQL BFF.',
  ].join('\n'),
)
process.exit(1)
