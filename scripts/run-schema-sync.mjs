/**
 * Run registry schema sync status for one entity (DDL push retired).
 *
 * Usage (BFF must be running):
 *   npm run bff:sync -- form            # dry-run (default)
 *   npm run bff:sync -- form --apply    # same path; apply no longer writes remote DDL
 */
const GRAPHQL_URL = process.env.VITE_GRAPHQL_URL || 'http://localhost:4000/graphql'
const entity = process.argv[2]
const apply = process.argv.includes('--apply')

if (!entity || entity.startsWith('-')) {
  console.error('Usage: npm run bff:sync -- <entity> [--apply]')
  process.exit(1)
}

const mutation = `
  mutation RunSchemaSync($entity: String!, $dryRun: Boolean) {
    runSchemaSync(entity: $entity, dryRun: $dryRun) {
      id
      status
      error
      result
    }
  }
`

const response = await fetch(GRAPHQL_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: mutation,
    variables: { entity, dryRun: !apply },
  }),
})

const json = await response.json()
if (json.errors?.length) {
  console.error(JSON.stringify(json.errors, null, 2))
  process.exit(1)
}

const job = json.data?.runSchemaSync
console.log(JSON.stringify(job, null, 2))
const result = job?.result ?? {}
console.log(
  `\n${result.dryRun ? 'dry-run' : 'applied'}: created=${result.createdCount ?? 0} skipped=${result.skippedCount ?? 0} errors=${result.errorCount ?? 0} statusAfter=${result.statusAfter ?? '?'}`,
)
