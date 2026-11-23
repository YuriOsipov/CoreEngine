import type {
  LayoutFieldMetadata,
  RecordPageComponent,
  RecordPageLayoutSchema,
} from '@/interfaces'
import {
  DEFAULT_MESSAGE_TIMELINE_SETTINGS,
  normalizeMessageTimelineSettings,
} from '@/interfaces'

/** Layout field for a Page Layout Message timeline component. */
export function buildRecordPageMessageTimelineField(
  collection: string,
  component: Pick<RecordPageComponent, 'id' | 'field' | 'label' | 'messageTimeline'>,
): LayoutFieldMetadata {
  return {
    id: component.id,
    field: component.field?.trim() || `message_timeline:${collection}`,
    label: component.label?.trim() || 'Messages',
    component: 'CrmMessageTimeline',
    span: 12,
    messageTimeline: normalizeMessageTimelineSettings(
      component.messageTimeline ?? DEFAULT_MESSAGE_TIMELINE_SETTINGS,
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

/** Message timeline components placed on a Page Layout. */
export function listRecordPageMessageTimelineFields(
  collection: string,
  pageLayout: RecordPageLayoutSchema | null | undefined,
): LayoutFieldMetadata[] {
  if (!pageLayout) return []

  const fields: LayoutFieldMetadata[] = []
  const seen = new Set<string>()
  for (const region of pageLayout.regions) {
    walkPageComponents(region.components, (component) => {
      if (component.type !== 'messageTimeline') return
      const field = buildRecordPageMessageTimelineField(collection, component)
      if (seen.has(field.field)) return
      seen.add(field.field)
      fields.push(field)
    })
  }
  return fields
}
