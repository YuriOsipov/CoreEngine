/**
 * Retired: one-shot legacy CMS → registry import after Supabase cutover.
 */
console.error(
  [
    'registry:import-presets was retired.',
    'Presets already live in public.app_presets (or equivalent registry tables).',
  ].join('\n'),
)
process.exit(1)
