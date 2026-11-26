#!/usr/bin/env node
/**
 * Switch @docengine/* dependency targets for CoreEngine (root) + crm-bff.
 *
 * Modes:
 *   npm   — published registry versions (GitHub / clone-and-run default)
 *   local — sibling ../docEngine packages (maintainers iterating on DocEngine)
 *   stub  — in-repo ci/stubs (local / explicit CI via DOCENGINE_ALLOW_STUBS only)
 *
 * Usage:
 *   node ./scripts/use-docengine.mjs npm|local|stub
 *   npm run docengine:use-npm
 *   npm run docengine:use-local
 *   npm run docengine:use-stub
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODE = String(process.argv[2] || '').trim().toLowerCase()
const VERSION = '0.0.107'

const ROOT_PACKAGES = ['@docengine/editor', '@docengine/field-date']
const BFF_PACKAGES = [
  '@docengine/editor',
  '@docengine/engine',
  '@docengine/pdf-renderer',
]

if (!['npm', 'local', 'stub'].includes(MODE)) {
  console.error(`Usage: node ./scripts/use-docengine.mjs <npm|local|stub>`)
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function setDeps(pkg, names, resolver) {
  pkg.dependencies ??= {}
  for (const name of names) {
    pkg.dependencies[name] = resolver(name)
  }
}

function rootResolver(name) {
  if (MODE === 'npm') return VERSION
  if (MODE === 'stub') {
    if (name === '@docengine/editor') return 'file:./ci/stubs/docengine-editor'
    if (name === '@docengine/field-date') return 'file:./ci/stubs/docengine-field-date'
  }
  // local
  if (name === '@docengine/editor') return 'file:../docEngine/packages/editor'
  if (name === '@docengine/field-date') return 'file:../docEngine/packages/field-date'
  throw new Error(`Unexpected root package ${name}`)
}

function bffResolver(name) {
  if (MODE === 'npm') return VERSION
  if (MODE === 'stub') {
    if (name === '@docengine/editor') return 'file:../ci/stubs/docengine-editor'
    if (name === '@docengine/engine') return 'file:../ci/stubs/docengine-engine'
    if (name === '@docengine/pdf-renderer') {
      return 'file:../ci/stubs/docengine-pdf-renderer'
    }
  }
  if (name === '@docengine/editor') return 'file:../../docEngine/packages/editor'
  if (name === '@docengine/engine') return 'file:../../docEngine/packages/engine'
  if (name === '@docengine/pdf-renderer') {
    return 'file:../../docEngine/packages/pdf-renderer'
  }
  throw new Error(`Unexpected bff package ${name}`)
}

const rootPath = join(ROOT, 'package.json')
const bffPath = join(ROOT, 'crm-bff', 'package.json')
const rootPkg = readJson(rootPath)
const bffPkg = readJson(bffPath)

setDeps(rootPkg, ROOT_PACKAGES, rootResolver)
setDeps(bffPkg, BFF_PACKAGES, bffResolver)

writeJson(rootPath, rootPkg)
writeJson(bffPath, bffPkg)

if (MODE === 'local') {
  const sibling = join(ROOT, '..', 'docEngine', 'packages', 'editor', 'package.json')
  if (!existsSync(sibling)) {
    console.warn(
      '[use-docengine] Warning: ../docEngine not found. Clone https://github.com/YuriiOsypov/docEngine next to CoreEngine, then npm install.',
    )
  }
}

console.log(`[use-docengine] mode=${MODE}`)
console.log(`[use-docengine] updated ${rootPath}`)
console.log(`[use-docengine] updated ${bffPath}`)
console.log('[use-docengine] Next: npm install && npm --prefix ./crm-bff install')
if (MODE === 'local') {
  console.log(
    '[use-docengine] Local override — do not commit package.json unless intentional. Restore with: npm run docengine:use-npm',
  )
}
if (MODE === 'npm') {
  console.log(
    `[use-docengine] Requires @docengine/*@${VERSION} on npmjs. Publish checklist: ../docEngine/docs/PUBLISH.md`,
  )
}
