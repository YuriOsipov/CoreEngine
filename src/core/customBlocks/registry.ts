/**
 * First-party / vertical custom Block Layout slots.
 *
 * Built-ins (Files, DocEngine, Scheduler, Tree) stay in CoreEngine.
 * Customer or vertical UI should register here from a **separate package**
 * (sibling repo or private npm) so CoreEngine upgrades do not merge your SFCs.
 *
 * @see docs/custom-blocks.md
 */
import type { Component } from 'vue'
import type { LayoutFieldMetadata } from '@/interfaces'

/** Props every extension block should accept (FormRenderer / FormRendererLight). */
export interface CustomBlockRenderProps {
  field: LayoutFieldMetadata
  collection: string
  recordId: string | number
  /** Parent form record when available (edit layouts). */
  modelValue?: Record<string, unknown>
  readonly?: boolean
  /** False when the hosting group is collapsed. */
  active?: boolean
}

export interface CustomBlockRegistration {
  /**
   * Stable id stored in layout JSON (`field.component`).
   * Prefer a namespaced value, e.g. `ClinicVitalsChart`, not a generic `Chart`.
   */
  component: string
  /** Default `field` key when dropped from the Form Builder palette. */
  fieldKey: string
  /** Palette / canvas label (call `t()` when registering if you need i18n). */
  label: string
  description?: string
  /** Runtime Vue SFC. */
  render: Component
  /** Full-width on Block Layouts (default true). */
  fullWidth?: boolean
  /** Icon class for Form Builder canvas (e.g. `pi-heart`). */
  icon?: string
}

const registry = new Map<string, CustomBlockRegistration>()

function normalizeComponentId(component: string): string {
  return String(component || '').trim()
}

/** Register (or replace) an extension block. Call once at app bootstrap. */
export function registerCustomBlock(def: CustomBlockRegistration): void {
  const id = normalizeComponentId(def.component)
  if (!id) throw new Error('registerCustomBlock: component is required')
  if (!def.fieldKey?.trim()) {
    throw new Error(`registerCustomBlock(${id}): fieldKey is required`)
  }
  if (!def.render) {
    throw new Error(`registerCustomBlock(${id}): render component is required`)
  }
  registry.set(id, {
    ...def,
    component: id,
    fieldKey: def.fieldKey.trim(),
    label: String(def.label || id).trim() || id,
    fullWidth: def.fullWidth !== false,
  })
}

export function unregisterCustomBlock(component: string): void {
  registry.delete(normalizeComponentId(component))
}

export function getCustomBlock(
  component: string | null | undefined,
): CustomBlockRegistration | undefined {
  const id = normalizeComponentId(String(component || ''))
  if (!id) return undefined
  return registry.get(id)
}

export function listCustomBlocks(): CustomBlockRegistration[] {
  return [...registry.values()]
}

export function isRegisteredCustomBlock(
  field: Pick<LayoutFieldMetadata, 'component'> | string | null | undefined,
): boolean {
  const component =
    typeof field === 'string' || field == null
      ? field
      : field.component
  return Boolean(getCustomBlock(component))
}

export function resolveCustomBlockRender(
  field: Pick<LayoutFieldMetadata, 'component'> | string | null | undefined,
): Component | null {
  const component =
    typeof field === 'string' || field == null
      ? field
      : field.component
  return getCustomBlock(component)?.render ?? null
}
