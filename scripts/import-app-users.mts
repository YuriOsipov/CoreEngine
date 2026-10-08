/**
 * Retired: one-shot legacy CMS → registry import after Supabase cutover.
 */
console.error(
  [
    'registry:import-app-users was retired.',
    'Users already live in public.app_users / app_user_credentials.',
  ].join('\n'),
)
process.exit(1)
