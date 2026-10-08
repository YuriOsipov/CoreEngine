/**
 * Retired: one-shot legacy CMS → registry import after Supabase cutover.
 */
console.error(
  [
    'registry:import-recent-views was retired.',
    'Recent views already live in public.recent_record_views.',
  ].join('\n'),
)
process.exit(1)
