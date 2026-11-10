import type {
  EntityAction,
  EntityLayoutSchema,
  LayoutFieldMetadata,
  RecordPageComponent,
  RecordPageLayoutSchema,
} from '@/interfaces'
import {
  isDataTableField,
  isFilesField,
  isM2ABuilderField,
} from '@/core/fieldHelpers'
import { keysEqual } from '@/core/utils/object'
import {
  loadEntityForms,
  loadEntityLayoutById,
  resolveEntityLayoutForCurrentUser,
} from '@/modules/config/services/layoutSettings'
import { resolveRecordPageLayoutForCurrentUser } from '@/modules/config/services/recordPageSettings'
import { buildRecordPageFilesField } from '@/modules/config/utils/recordPageFiles'

/** Fields that Page Layout Related List and object-list Detail panel can host. */
export function isBlockLayoutRelatedListField(field: LayoutFieldMetadata): boolean {
  if (isDataTableField(field)) return Boolean(field.relatedCollection)
  if (isFilesField(field)) return true
  if (isM2ABuilderField(field)) return true
  return false
}

/** Related-object fields configured on a Block Layout (DataTable, Files, M2A). */
export function listBlockLayoutRelatedListFields(
  schema: EntityLayoutSchema | null | undefined,
): LayoutFieldMetadata[] {
  if (!schema) return []
  const fields: LayoutFieldMetadata[] = []
  for (const section of schema.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        if (isBlockLayoutRelatedListField(field)) {
          fields.push(field)
        }
      }
    }
  }
  return fields
}

export function findBlockLayoutRelatedListField(
  schema: EntityLayoutSchema | null | undefined,
  relatedFieldId?: string | null,
  relatedCollection?: string | null,
): LayoutFieldMetadata | null {
  const fields = listBlockLayoutRelatedListFields(schema)
  if (!fields.length) return null

  if (relatedFieldId) {
    const byId = fields.find((field) => field.id === relatedFieldId)
    if (byId) return byId
  }

  if (relatedCollection) {
    const byCollection = fields.find((field) =>
      keysEqual(field.relatedCollection ?? '', relatedCollection),
    )
    if (byCollection) return byCollection
  }

  return null
}

/**
 * DataTable field config for a related-collection full list page.
 * Prefers Page Layout related/detail Block Layouts (where List actions are edited),
 * then the page default Block Layout, then the role-resolved entity layout.
 */
export async function resolveRelatedListDataTableField(
  parentCollection: string,
  relatedCollection: string,
): Promise<LayoutFieldMetadata | null> {
  const related = relatedCollection.trim()
  if (!parentCollection.trim() || !related) return null

  let fallback: LayoutFieldMetadata | null = null

  const consider = (field: LayoutFieldMetadata | null | undefined): LayoutFieldMetadata | null => {
    if (!field || !isDataTableField(field)) return null
    if (!keysEqual(field.relatedCollection ?? '', related)) return null
    if (hasListDocumentActions(field)) return field
    if (!fallback) fallback = field
    return null
  }

  const pageLayout = await resolveRecordPageLayoutForCurrentUser(parentCollection)
  if (pageLayout) {
    const { fields } = await resolveRecordPageListDetailContent(
      parentCollection,
      pageLayout,
      { respectRelatedListsSource: false },
    )
    for (const field of fields) {
      const hit = consider(field)
      if (hit) return hit
    }

    const defaultLayoutId = pageLayout.pageLayoutId?.trim()
    const layoutIds = new Set<string>()
    if (defaultLayoutId) layoutIds.add(defaultLayoutId)
    for (const region of pageLayout.regions) {
      walkPageComponents(region.components, (component) => {
        const id = component.pageLayoutId?.trim()
        if (id) layoutIds.add(id)
      })
    }
    for (const layoutId of layoutIds) {
      const schema = await loadEntityLayoutById(parentCollection, layoutId)
      const hit = consider(findBlockLayoutRelatedListField(schema, null, related))
      if (hit) return hit
    }
  }

  const entityLayout = await resolveEntityLayoutForCurrentUser(parentCollection)
  {
    const hit = consider(findBlockLayoutRelatedListField(entityLayout, null, related))
    if (hit) return hit
  }

  // Named Block Layouts (setup editor) may hold List actions even when not role-default.
  try {
    const forms = await loadEntityForms(parentCollection)
    for (const form of forms) {
      const schema = await loadEntityLayoutById(parentCollection, form.id)
      const hit = consider(findBlockLayoutRelatedListField(schema, null, related))
      if (hit) return hit
    }
  } catch {
    // Keep page-layout / role-resolved match.
  }

  return fallback
}

function hasListDocumentActions(field: LayoutFieldMetadata): boolean {
  return Boolean(
    field.dataTable?.actions?.some((action) => action.document?.templateId?.trim()),
  )
}

export function relatedListFieldTabLabel(field: LayoutFieldMetadata): string {
  return field.label?.trim() || field.relatedCollection || field.field
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

function fieldDedupeKey(field: LayoutFieldMetadata): string {
  if (field.component === 'Files') {
    return `files:${field.field}`
  }
  return field.id || `${field.component}:${field.relatedCollection || field.field}`
}

function pushUniqueField(
  target: LayoutFieldMetadata[],
  seen: Set<string>,
  field: LayoutFieldMetadata,
): void {
  const key = fieldDedupeKey(field)
  if (seen.has(key)) return
  seen.add(key)
  target.push(field)
}

/**
 * Related lists for the object-list Detail panel: every Related List / Files component
 * plus related fields from Detail Block Layouts placed on the Page Layout.
 * When `listDetailPanel.relatedListsSource` is `block`, only related fields from the
 * selected Block Layout Setting are used (unless `respectRelatedListsSource` is false).
 */
export async function resolveRecordPageListDetailContent(
  collection: string,
  pageLayout: RecordPageLayoutSchema | null | undefined,
  options?: { respectRelatedListsSource?: boolean },
): Promise<{ fields: LayoutFieldMetadata[]; actions: EntityAction[] }> {
  if (!pageLayout) return { fields: [], actions: [] }

  const fields: LayoutFieldMetadata[] = []
  const seen = new Set<string>()
  const blockLayoutCache: Record<string, EntityLayoutSchema | null> = {}
  let actions: EntityAction[] = []
  const respectRelatedListsSource = options?.respectRelatedListsSource !== false

  async function loadBlock(layoutId: string | null | undefined): Promise<EntityLayoutSchema | null> {
    const id = layoutId?.trim()
    if (!id) return null
    if (!(id in blockLayoutCache)) {
      try {
        blockLayoutCache[id] = await loadEntityLayoutById(collection, id)
      } catch {
        blockLayoutCache[id] = null
      }
    }
    return blockLayoutCache[id] ?? null
  }

  const defaultLayoutId = pageLayout.pageLayoutId?.trim() || null
  if (defaultLayoutId) {
    const defaultSchema = await loadBlock(defaultLayoutId)
    if (defaultSchema?.actions?.length) {
      actions = defaultSchema.actions
    }
  }

  const source =
    respectRelatedListsSource && pageLayout.listDetailPanel?.relatedListsSource === 'block'
      ? 'block'
      : 'all'

  if (source === 'block') {
    const blockLayoutId = pageLayout.listDetailPanel?.relatedListsBlockId?.trim() || null
    if (!blockLayoutId) return { fields, actions }

    const schema = await loadBlock(blockLayoutId)
    if (!schema) return { fields, actions }

    if (!actions.length && schema.actions?.length) {
      actions = schema.actions
    }
    for (const field of listBlockLayoutRelatedListFields(schema)) {
      pushUniqueField(fields, seen, field)
    }
    return { fields, actions }
  }

  const components: RecordPageComponent[] = []
  for (const region of pageLayout.regions) {
    walkPageComponents(region.components, (component) => components.push(component))
  }

  for (const component of components) {
    if (component.type === 'files') {
      pushUniqueField(fields, seen, buildRecordPageFilesField(collection, component))
      continue
    }

    if (component.type !== 'relatedList' && component.type !== 'detail') continue

    const layoutId = component.pageLayoutId?.trim() || defaultLayoutId
    const schema = await loadBlock(layoutId)
    if (!schema) continue

    if (!actions.length && schema.actions?.length) {
      actions = schema.actions
    }

    for (const field of listBlockLayoutRelatedListFields(schema)) {
      pushUniqueField(fields, seen, field)
    }
  }

  return { fields, actions }
}
