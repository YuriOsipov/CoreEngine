import type { PrimeVueComponentType } from '@/interfaces'

export interface PaletteItem {
  /** Stable key for draggable item-key and clone source identity. */
  id: string
  label: string
  component: PrimeVueComponentType
  /** Registry column, relation, or related collection key used as layout binding. */
  fieldKey: string
  fieldType: string
  description?: string
  /** M2O parent collection for dynamic Select options. */
  relatedCollection?: string
  paletteKind?: 'field' | 'relatedObject' | 'blockLayout'
  /** Block Layout Setting id when {@link paletteKind} is `blockLayout`. */
  blockLayoutId?: string
  /** true for multi-file (special: 'files'), false for single-file (special: 'file'). */
  multiple?: boolean
}
