import { appendFileRequestFields } from '@/core/filesField'
import { buildFileAssetUrl } from '@/core/fileImageValue'
import { isFilesField } from '@/core/fieldHelpers'
import { bridgeReadItem } from '@/core/graphql/itemsBridge'
import {
  fileIsImage,
  fileItemId,
  resolvedFileObj,
  type FileItem,
} from '@/core/useFiles'
import { resolveEntityLayoutForCurrentUser } from '@/modules/config/services/layoutSettings'
import type { EntityLayoutSchema, LayoutFieldMetadata } from '@/interfaces'

export interface RecordImageAttachment {
  fileId: string
  title: string
  fieldKey: string
  fieldLabel: string
  thumbnailUrl: string
  assetUrl: string
}

function collectFilesLayoutFields(schema: EntityLayoutSchema): LayoutFieldMetadata[] {
  const fields: LayoutFieldMetadata[] = []

  for (const section of schema.sections) {
    for (const group of section.groups) {
      for (const field of group.fields) {
        if (isFilesField(field)) {
          fields.push(field)
        }
      }
    }
  }

  return fields
}

function buildRecordFileRequestFields(fileFields: LayoutFieldMetadata[]): string[] {
  const requestFields = new Set<string>(['id'])

  for (const field of fileFields) {
    requestFields.add(field.field)
    appendFileRequestFields(requestFields, field)
  }

  return [...requestFields]
}

function pushImageAttachment(
  field: LayoutFieldMetadata,
  item: FileItem,
  target: RecordImageAttachment[],
): void {
  if (!fileIsImage(item)) return

  const meta = resolvedFileObj(item)
  const fileId = fileItemId(item)
  if (!fileId) return

  target.push({
    fileId,
    title: meta.title?.trim() || meta.filename_download?.trim() || fileId,
    fieldKey: field.field,
    fieldLabel: field.label,
    thumbnailUrl: buildFileAssetUrl(fileId, { width: 120, height: 120, fit: 'cover' }),
    assetUrl: buildFileAssetUrl(fileId, { width: 1200 }),
  })
}

function collectImagesFromFieldValue(
  field: LayoutFieldMetadata,
  raw: unknown,
  target: RecordImageAttachment[],
): void {
  if (raw == null) return

  const items = Array.isArray(raw) ? raw : [raw]
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    pushImageAttachment(field, item as FileItem, target)
  }
}

/** Loads image attachments from all Files layout fields on the entity. */
export async function loadRecordImageAttachments(
  collection: string,
  recordId: string,
): Promise<RecordImageAttachment[]> {
  const layout = await resolveEntityLayoutForCurrentUser(collection)
  if (!layout) return []

  const fileFields = collectFilesLayoutFields(layout)
  if (!fileFields.length) return []

  const record = await bridgeReadItem(collection, recordId, {
    fields: buildRecordFileRequestFields(fileFields),
  })

  const attachments: RecordImageAttachment[] = []

  for (const field of fileFields) {
    collectImagesFromFieldValue(field, record[field.field], attachments)
  }

  return attachments
}
