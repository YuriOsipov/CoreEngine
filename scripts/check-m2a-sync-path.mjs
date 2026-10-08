/**
 * Assert M2A / alias interface helpers used by schema sync.
 * No remote CMS or DB required — validates the shared M2A junction path markers.
 *
 * Usage: npm run bff:check-m2a-path
 */
import {
  aliasInterfaceForSpecial,
  isRelationInterfaceName,
  RELATION_INTERFACES,
  specialForAliasInterface,
} from '../crm-bff/src/sync/relationInterfaceUtils.ts'

const cases = [
  { iface: 'list-m2a', special: ['m2a'], alias: 'list-m2a' },
  { iface: 'm2a', special: ['m2a'], alias: 'list-m2a' },
  { iface: 'list-m2m', special: ['m2m'], alias: 'list-m2m' },
  { iface: 'files', special: ['files'], alias: 'files' },
  { iface: 'list-o2m', special: ['o2m'], alias: 'list-o2m' },
  { iface: null, special: ['o2m'], alias: 'list-o2m' },
]

let failed = 0
for (const row of cases) {
  const special = specialForAliasInterface(row.iface)
  const alias = aliasInterfaceForSpecial(special)
  const ok =
    special.join(',') === row.special.join(',') && alias === row.alias
  if (!ok) {
    failed += 1
    console.error('FAIL', row, { special, alias })
  }
}

if (!RELATION_INTERFACES.has('m2a') || !RELATION_INTERFACES.has('list-m2a')) {
  failed += 1
  console.error('FAIL: RELATION_INTERFACES missing m2a / list-m2a')
}

if (!isRelationInterfaceName('list-m2a') || !isRelationInterfaceName('select-dropdown-m2a')) {
  failed += 1
  console.error('FAIL: isRelationInterfaceName should treat m2a interfaces as relations')
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}

console.log('ok: M2A sync path helpers (special=m2a, alias=list-m2a)')
console.log('note: live expand smoke — npm run bff:check-m2a-expand (bare + nested blocks)')
