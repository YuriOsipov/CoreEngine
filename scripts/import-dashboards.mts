/**
 * Retired: one-shot legacy CMS → registry import after Supabase cutover.
 */
console.error(
  [
    'registry:import-dashboards was retired.',
    'Dashboards already live in Supabase registry tables.',
  ].join('\n'),
)
process.exit(1)
