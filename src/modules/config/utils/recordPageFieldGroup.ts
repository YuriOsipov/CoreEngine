import type {
  EntityLayoutSchema,
  LayoutFieldMetadata,
  PrimeVueComponentType,
  RecordPageComponent,
} from '@/interfaces'

/** Build a FormRendererLight schema from a Page Layout Field group. */
export function buildFieldGroupSchema(
  collection: string,
  component: RecordPageComponent,
): EntityLayoutSchema | null {
  if (component.type !== 'fieldGroup') return null

  const columnCount: 1 | 2 = component.columns === 1 ? 1 : 2
  const fields: LayoutFieldMetadata[] = (component.components ?? [])
    .filter((child): child is RecordPageComponent & { field: string; fieldComponent: PrimeVueComponentType } =>
      child.type === 'field'
      && typeof child.field === 'string'
      && Boolean(child.field)
      && Boolean(child.fieldComponent),
    )
    .map((child) => ({
      id: child.id,
      field: child.field,
      label: child.label || child.field,
      component: child.fieldComponent,
      span: columnCount === 1 ? 12 : 6,
      format: child.format,
      relatedCollection: child.relatedCollection,
    }))

  return {
    entity: collection,
    version: 1,
    actions: [],
    systemInfo: { enabled: false },
    sections: [
      {
        id: `field_group_section_${component.id}`,
        columns: 12,
        groups: [
          {
            id: `field_group_${component.id}`,
            title: component.label?.trim() || 'Section',
            fields,
            collapsed: component.collapsed === true,
            inlineLabels: component.inlineLabels !== false,
          },
        ],
      },
    ],
  }
}
