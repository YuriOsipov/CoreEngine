import { FILES_ASSET_COLLECTION } from '@/core/filesField'
import type {
  LayoutFieldMetadata,
  RecordPageComponent,
  RecordPageLayoutSchema,
} from '@/interfaces'

const DEFAULT_FILES_SETTINGS: NonNullable<LayoutFieldMetadata['files']> = {
  multiple: true,
  display: 'thumbnail',
  allowedMimeTypes: [],
  columns: [],
}

/** Layout field for a Page Layout Files component (shared Files object). */
export function buildRecordPageFilesField(
  collection: string,
  component: Pick<RecordPageComponent, 'id' | 'field' | 'label' | 'relatedCollection'>,
): LayoutFieldMetadata {
  return {
    id: component.id,
    field: component.field?.trim() || `files:${collection}`,
    label: component.label?.trim() || 'Files',
    component: 'Files',
    span: 12,
    relatedCollection: FILES_ASSET_COLLECTION,
    files: { ...DEFAULT_FILES_SETTINGS },
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

/** Files components placed on a Page Layout. */
export function listRecordPageFilesFields(
  collection: string,
  pageLayout: RecordPageLayoutSchema | null | undefined,
): LayoutFieldMetadata[] {
  if (!pageLayout) return []

  const fields: LayoutFieldMetadata[] = []
  const seen = new Set<string>()
  for (const region of pageLayout.regions) {
    walkPageComponents(region.components, (component) => {
      if (component.type !== 'files') return
      const field = buildRecordPageFilesField(collection, component)
      if (seen.has(field.field)) return
      seen.add(field.field)
      fields.push(field)
    })
  }
  return fields
}
