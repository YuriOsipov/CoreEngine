import { FILES_JUNCTION_FILE_ID_FIELD } from '@/core/filesField'
import { bridgeCreateItem } from '@/core/graphql/itemsBridge'
import { uploadFile } from '@/core/graphql/filesProxy'
import {
  findParentFkField,
  resolveObjectFilesChild,
} from '@/modules/entities/services/collectionSchema'

/**
 * Store a sync-response file on the record and, when the object has an
 * attachments junction, add the junction row the Attachments list reads.
 */
export async function attachFlowResponseFile(
  file: File,
  parentCollection: string,
  parentRecordId: string,
): Promise<void> {
  const collection = parentCollection.trim()
  const recordId = parentRecordId.trim()
  if (!collection || !recordId) {
    throw new Error('Record is required to save the attachment.')
  }

  const uploaded = await uploadFile(file, {
    collection,
    recordId,
  })

  const child = await resolveObjectFilesChild(collection)
  if (!child?.relatedCollection) return

  const parentFk = await findParentFkField(child.relatedCollection, collection)
  const payload: Record<string, unknown> = {
    [FILES_JUNCTION_FILE_ID_FIELD]: uploaded.id,
  }
  if (parentFk) payload[parentFk] = recordId
  await bridgeCreateItem(child.relatedCollection, payload)
}
