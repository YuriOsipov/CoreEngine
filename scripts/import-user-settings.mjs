/**
 * Retired: one-shot legacy CMS → registry import after Supabase cutover.
 */
console.error(
  [
    'registry:import-user-settings was retired.',
    'User settings already live in public.user_settings.',
  ].join('\n'),
)
process.exit(1)
