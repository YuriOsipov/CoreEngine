import { describe, expect, it } from 'vitest'
import { parseAppearance, resolveDark } from './appearance'
import {
  isPrimaryColorId,
  isSurfaceColorId,
  primaryPresetExtension,
} from './appearancePalettes'

describe('parseAppearance', () => {
  it('falls back when nothing is stored', () => {
    expect(parseAppearance(null)).toEqual({
      preset: 'aura',
      colorScheme: 'system',
      primary: 'emerald',
      surface: 'zinc',
    })
  })

  it('keeps a known preset, color scheme, and palettes', () => {
    expect(
      parseAppearance(
        '{"preset":"nora","colorScheme":"dark","primary":"indigo","surface":"slate"}',
      ),
    ).toEqual({
      preset: 'nora',
      colorScheme: 'dark',
      primary: 'indigo',
      surface: 'slate',
    })
  })

  it('ignores unknown values and broken JSON', () => {
    expect(parseAppearance('{"preset":"nile","colorScheme":"sepia","primary":"neon","surface":"glass"}')).toEqual({
      preset: 'aura',
      colorScheme: 'system',
      primary: 'emerald',
      surface: 'zinc',
    })
    expect(parseAppearance('{')).toEqual({
      preset: 'aura',
      colorScheme: 'system',
      primary: 'emerald',
      surface: 'zinc',
    })
  })

  it('fills missing primary/surface from older stored settings', () => {
    expect(parseAppearance('{"preset":"lara","colorScheme":"light"}')).toEqual({
      preset: 'lara',
      colorScheme: 'light',
      primary: 'emerald',
      surface: 'zinc',
    })
  })
})

describe('resolveDark', () => {
  it('follows an explicit choice', () => {
    expect(resolveDark('dark', false)).toBe(true)
    expect(resolveDark('light', true)).toBe(false)
  })

  it('follows the system preference only for system', () => {
    expect(resolveDark('system', true)).toBe(true)
    expect(resolveDark('system', false)).toBe(false)
  })
})

describe('appearancePalettes', () => {
  it('validates primary and surface ids', () => {
    expect(isPrimaryColorId('emerald')).toBe(true)
    expect(isPrimaryColorId('neon')).toBe(false)
    expect(isSurfaceColorId('zinc')).toBe(true)
    expect(isSurfaceColorId('glass')).toBe(false)
  })

  it('builds a noir primary overlay that links to surface tokens', () => {
    const ext = primaryPresetExtension('noir') as {
      semantic: { primary: Record<string, string> }
    }
    expect(ext.semantic.primary[500]).toBe('{surface.500}')
  })

  it('builds a colored primary overlay with a 500 stop', () => {
    const ext = primaryPresetExtension('indigo') as {
      semantic: { primary: Record<string, string> }
    }
    expect(ext.semantic.primary[500]).toBe('#6366f1')
  })
})
