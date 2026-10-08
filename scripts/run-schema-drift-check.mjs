/**
 * Run schema drift check against the GraphQL BFF.
 *
 * Usage (from repo root, BFF must be running):
 *   npm run bff:drift
 *   npm run bff:drift -- visit
 */
const GRAPHQL_URL = process.env.VITE_GRAPHQL_URL || 'http://localhost:4000/graphql'
const entity = process.argv[2] || null

const mutation = `
  mutation RunSchemaDriftCheck($entity: String) {
    runSchemaDriftCheck(entity: $entity) {
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
    variables: { entity },
  }),
})

const json = await response.json()
if (json.errors?.length) {
  console.error(JSON.stringify(json.errors, null, 2))
  process.exit(1)
}

const job = json.data?.runSchemaDriftCheck
console.log(JSON.stringify(job, null, 2))

const result = job?.result ?? {}
console.log(
  `\nsummary: entities=${result.entityCount ?? 0} ok=${result.okCount ?? 0} drift=${result.driftCount ?? 0} error=${result.errorCount ?? 0}`,
)
