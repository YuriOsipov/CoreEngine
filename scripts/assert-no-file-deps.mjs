#!/usr/bin/env node
/**
 * Fail if root or crm-bff package.json pins any dependency via file:.
 * Guards against committing `npm run docengine:use-local` (or use-stub) overrides.
 *
 * Usage: node ./scripts/assert-no-file-deps.mjs
 *        npm run assert:no-file-deps
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_PATHS = [join(ROOT, 'package.json'), join(ROOT, 'crm-bff', 'package.json')]
const DEP_KEYS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]

function collectFileRefs(pkgPath) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const hits = []
  for (const key of DEP_KEYS) {
    const block = pkg[key]
    if (!block || typeof block !== 'object') continue
    for (const [name, version] of Object.entries(block)) {
      if (typeof version === 'string' && version.trim().toLowerCase().startsWith('file:')) {
        hits.push({ name, version: version.trim(), section: key })
      }
    }
  }
  return hits
}

let failed = 0
for (const pkgPath of PKG_PATHS) {
  const hits = collectFileRefs(pkgPath)
  if (!hits.length) continue
  failed += hits.length
  console.error(`[assert-no-file-deps] ${pkgPath} has file: dependency pins:`)
  for (const hit of hits) {
    console.error(`  - ${hit.section}.${hit.name}: ${hit.version}`)
  }
}

if (failed) {
  console.error(
    '[assert-no-file-deps] Restore published pins with: npm run docengine:use-npm',
  )
  process.exit(1)
}

console.log('[assert-no-file-deps] ok — no file: dependency pins in package.json')
