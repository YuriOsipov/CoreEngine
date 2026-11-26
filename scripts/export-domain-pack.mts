/**
 * Export the current DB registry into a domain pack under supabase/domains/<id>/.
 *
 * Usage (repo root):
 *   npm run platform:export-pack -- sales
 *   npm run platform:export-pack -- clinic
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../crm-bff/src/db/pool.ts'
import {
  exportDomainPack,
  type PackManifest,
} from '../crm-bff/src/packs/exportDomainPack.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const packId = process.argv[2]?.trim().toLowerCase()
if (!packId || packId.startsWith('-')) {
  console.error('Usage: export-domain-pack.mts <sales|clinic|…>')
  process.exit(1)
}

const packDir = resolve(repoRoot, 'supabase', 'domains', packId)
mkdirSync(packDir, { recursive: true })

const manifestPath = resolve(packDir, 'pack.json')
const existingManifest: Partial<PackManifest> = existsSync(manifestPath)
  ? readJson<PackManifest>(manifestPath)
  : {}

const exported = await exportDomainPack({
  packId,
  manifest: existingManifest,
  includeRecords: true,
  includeDashboards: true,
})

const { pack: manifest } = exported

writeJson(resolve(packDir, 'pack.json'), manifest)
writeJson(resolve(packDir, manifest.entitiesFile), {
  entities: exported.entities,
})
writeJson(resolve(packDir, manifest.platformFile!), {
  entities: exported.platformEntities,
})
writeJson(resolve(packDir, manifest.layoutsFile), {
  layouts: exported.layouts,
})
writeJson(resolve(packDir, manifest.rolesFile), { roles: exported.roles })
writeJson(resolve(packDir, manifest.recordsFile!), {
  recordsByEntity: exported.recordsByEntity,
})
writeJson(resolve(packDir, manifest.dashboardsFile!), {
  dashboards: exported.dashboards,
  panels: exported.panels,
})
writeJson(resolve(packDir, manifest.navigationFile!), {
  apps: exported.navigationApps,
})

console.log(`Exported domain pack: ${packId}`)
console.log(
  `  entities: ${exported.meta.entityNames.join(', ') || '(none)'}`,
)
console.log(
  `  platform overlays: ${exported.meta.platformEntityNames.join(', ') || '(none)'}`,
)
console.log(`  layouts: ${exported.layouts.length}`)
console.log(
  `  roles: ${exported.roles.map((r) => r.name).join(', ') || '(none)'}`,
)
console.log(
  `  record entities: ${Object.keys(exported.recordsByEntity).join(', ') || '(none)'}`,
)
console.log(
  `  dashboards: ${exported.dashboards.length}, panels: ${exported.panels.length}`,
)
console.log(`  navigation apps: ${exported.navigationApps.length}`)
console.log(`  path: ${packDir}`)

await pool.end()
