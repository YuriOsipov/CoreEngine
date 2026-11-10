import type {
  LayoutFieldMetadata,
  RecordPageComponent,
  RecordPageLayoutSchema,
} from '@/interfaces'
import {
  collectConditionFieldPaths,
  showIfRequestFields,
} from '@/core/recordConditionMatch'

function walkPageComponents(
  components: RecordPageComponent[] | undefined,
  visit: (component: RecordPageComponent) => void,
): void {
  for (const component of components ?? []) {
    visit(component)
    if (component.components?.length) {
      walkPageComponents(component.components, visit)
    }
    for (const tab of component.tabs ?? []) {
      walkPageComponents(tab.components, visit)
    }
  }
}

/**
 * Extra GraphQL fields needed for Path components on a Page Layout
 * (stage field, terminal field, and readonly-if condition fields).
 */
export function collectPathLayoutExtraFields(
  pageLayout: RecordPageLayoutSchema | null | undefined,
): LayoutFieldMetadata[] {
  if (!pageLayout) return []
  const fields: LayoutFieldMetadata[] = []
  const seen = new Set<string>()

  const add = (field: string): void => {
    const name = field.trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    fields.push({
      id: `path_extra_${name}`,
      field: name,
      label: name,
      component: 'Select',
      span: 6,
    })
  }

  for (const region of pageLayout.regions) {
    walkPageComponents(region.components, (component) => {
      if (component.type !== 'path') return
      for (const key of [component.field, component.terminalField]) {
        if (typeof key === 'string') add(key)
      }
      for (const path of showIfRequestFields(
        collectConditionFieldPaths(component.readonlyIf),
      )) {
        add(path)
      }
    })
  }

  return fields
}
