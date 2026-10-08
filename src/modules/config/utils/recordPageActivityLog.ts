import type {
  LayoutFieldMetadata,
  RecordPageComponent,
  RecordPageLayoutSchema,
} from '@/interfaces'
import {
  DEFAULT_ACTIVITY_LOG_SETTINGS,
  normalizeActivityLogSettings,
} from '@/interfaces'

/** Layout field for a Page Layout Activity log component. */
export function buildRecordPageActivityLogField(
  collection: string,
  component: Pick<RecordPageComponent, 'id' | 'field' | 'label' | 'activityLog'>,
): LayoutFieldMetadata {
  return {
    id: component.id,
    field: component.field?.trim() || `activity_log:${collection}`,
    label: component.label?.trim() || 'Activity history',
    component: 'CrmActivityLog',
    span: 12,
    activityLog: normalizeActivityLogSettings(
      component.activityLog ?? DEFAULT_ACTIVITY_LOG_SETTINGS,
    ),
  }
}

function walkPageComponents(
  components: RecordPageComponent[],
  visit: (component: RecordPageComponent) => void,
): void {
  for (const component of components) {
    visit(component)
    if (component.type === 'fieldGroup' && component.components) {
      walkPageComponents(component.components, visit)
    }
    if (!component.tabs) continue
    for (const tab of component.tabs) {
      walkPageComponents(tab.components, visit)
    }
  }
}

/** Activity log components placed on a Page Layout. */
export function listRecordPageActivityLogFields(
  collection: string,
  pageLayout: RecordPageLayoutSchema | null | undefined,
): LayoutFieldMetadata[] {
  if (!pageLayout) return []

  const fields: LayoutFieldMetadata[] = []
  const seen = new Set<string>()
  for (const region of pageLayout.regions) {
    walkPageComponents(region.components, (component) => {
      if (component.type !== 'activityLog') return
      const field = buildRecordPageActivityLogField(collection, component)
      if (seen.has(field.field)) return
      seen.add(field.field)
      fields.push(field)
    })
  }
  return fields
}
