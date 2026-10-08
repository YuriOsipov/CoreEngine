/**
 * Retired: one-shot legacy CMS → registry import after Supabase cutover.
 */
console.error(
  [
    'registry:import-roles was retired.',
    'Roles already live in public.app_roles. Re-seed from SQL/backups if needed.',
  ].join('\n'),
)
process.exit(1)
