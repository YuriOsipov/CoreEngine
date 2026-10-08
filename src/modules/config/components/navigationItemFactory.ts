import type { NavFolder, NavLink } from '@/interfaces'

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function createNavLink(): NavLink {
  return {
    id: genId('navitem'),
    type: 'link',
    label: '',
    target: { kind: 'home' },
  }
}

export function createNavFolder(): NavFolder {
  return {
    id: genId('navitem'),
    type: 'folder',
    label: '',
    collapsed: false,
    children: [],
  }
}
