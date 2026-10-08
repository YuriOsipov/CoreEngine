import { query } from './src/db/pool.ts'

async function main() {
  const rows = await query(
    `SELECT name, body
     FROM public.settings
     WHERE collection = 'visit'
       AND group_key IN ('entity', 'enity')
       AND sub_group = 'full'
     LIMIT 10`,
  )
  for (const r of rows) {
    const body =
      typeof r.body === 'string' ? JSON.parse(r.body as string) : r.body
    const schema = body as {
      sections?: Array<{
        groups?: Array<{ fields?: Array<Record<string, unknown>> }>
      }>
    }
    const fields = (schema.sections || []).flatMap((s) =>
      (s.groups || []).flatMap((g) => g.fields || []),
    )
    const patient = fields.find((f) => f.field === 'patient')
    console.log('LAYOUT', r.name)
    console.log(patient ? JSON.stringify(patient, null, 2) : 'no patient field')
  }
}

void main()
