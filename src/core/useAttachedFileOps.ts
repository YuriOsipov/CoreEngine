import { reactive, ref } from 'vue'
import type { Ref } from 'vue' // used for typed refs below
import type { MenuItem } from 'openvue/menuitem'
import { useToast } from 'openvue/usetoast'
import type { LayoutFieldMetadata } from '@/interfaces'
import {
  bridgeCreateItem,
  bridgeDeleteItem,
} from '@/core/graphql/itemsBridge'
import { uploadFile, deleteFile, linkFileToRecord } from '@/core/graphql/filesProxy'
import {
  type FileItem,
  type FilePreviewData,
  fileItemId,
  fileItemName,
  fileIsUnavailable,
  resolvedFileObj,
  safeFileDownloadUrl,
  useFiles,
} from '@/core/useFiles'
import {
  FILES_JUNCTION_FILE_ID_FIELD,
  isFilesAssetCollection,
  resolveFilesUploadConstraints,
  type CoreEngineFileDragPayload,
} from '@/core/filesField'
import { filesSettings, isSingleFileField } from '@/core/fieldHelpers'
import {
  findParentFkField,
  getCachedCollectionFields,
  resolveAttachedFilesCollection,
} from '@/modules/entities/services/collectionSchema'
import type { FieldDefinition } from '@/interfaces'
import { keysEqual } from '@/core/utils/object'

type FilesHandle = ReturnType<typeof useFiles>
type ConfirmHandle = { require: (opts: Record<string, unknown>) => void }
type TranslateFn = (key: string, fallback?: string, params?: Record<string, string | number>) => string

export interface UseAttachedFileOpsOptions {
  field: () => LayoutFieldMetadata
  files: () => FileItem[]
  parentName: () => string | undefined
  parentId: () => string | number | undefined | null
  filesStore: FilesHandle
  t: TranslateFn
  confirm: ConfirmHandle
  toggleMenu: (event: Event) => void
}

export function useAttachedFileOps(options: UseAttachedFileOpsOptions) {
  const { field, files, parentName, parentId, filesStore, t, confirm, toggleMenu } = options
  const toast = useToast()

  // ── Loading state ─────────────────────────────────────────────────────────
  const uploadLoading = ref(false)
  const deleteLoading = reactive<Record<string, string | null>>({})

  // ── Preview ───────────────────────────────────────────────────────────────
  const previewVisible = ref(false)
  const previewFileData: Ref<FilePreviewData | null> = ref(null)
  const previewJunctionId: Ref<string | null> = ref(null)

  function openPreview(item: FileItem): void {
    if (fileIsUnavailable(item)) return
    const meta = resolvedFileObj(item)
    previewFileData.value = {
      id: fileItemId(item) ?? '',
      filename_download: meta.filename_download,
      type: meta.type,
      filesize: meta.filesize,
      created_on: meta.created_on,
      uploaded_by: meta.uploaded_by,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      location: meta.location,
      focal_point_x: meta.focal_point_x,
      focal_point_y: meta.focal_point_y,
      width: meta.width,
      height: meta.height,
    }
    previewJunctionId.value = item.id ?? null
    previewVisible.value = true
  }

  function handleFileUpdated(updated: FilePreviewData): void {
    filesStore.setFiles(
      field().field,
      files().map((item) => {
        if (fileItemId(item) !== updated.id) return item
        const nested = item[FILES_JUNCTION_FILE_ID_FIELD]
        if (nested && typeof nested === 'object') {
          return { ...item, [FILES_JUNCTION_FILE_ID_FIELD]: { ...nested, ...updated } }
        }
        return { ...item, ...updated }
      }),
    )
    previewFileData.value = updated
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  async function loadFieldDefinition(): Promise<FieldDefinition | null> {
    const entity = parentName()?.trim()
    if (!entity) return null
    try {
      const fields = (await getCachedCollectionFields(entity)) as FieldDefinition[]
      return fields.find((item) => keysEqual(item.field, field().field)) ?? null
    } catch {
      return null
    }
  }

  async function uploadConstraints(): Promise<{
    allowedMimeTypes: string[]
    maxFileSizeMb: number | null
  }> {
    const definition = await loadFieldDefinition()
    return resolveFilesUploadConstraints(field(), definition)
  }

  function triggerUpload(): void {
    void (async () => {
      const constraints = await uploadConstraints()
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = Boolean(filesSettings(field())?.multiple)
      if (constraints.allowedMimeTypes.length) {
        input.accept = constraints.allowedMimeTypes.join(',')
      }
      input.onchange = (e) => void handleFileUpload(e)
      input.click()
    })()
  }

  async function handleFileUpload(event: Event): Promise<void> {
    await uploadFilesFromList((event.target as HTMLInputElement).files)
  }

  function fileMatchesAllowedMimeTypes(
    file: File,
    allowedMimeTypes: string[],
  ): boolean {
    if (!allowedMimeTypes.length) return true
    return allowedMimeTypes.some(
      (mime) => file.type === mime || file.type.startsWith(mime),
    )
  }

  function fileWithinMaxSize(file: File, maxFileSizeMb: number | null): boolean {
    if (typeof maxFileSizeMb !== 'number' || maxFileSizeMb <= 0) return true
    return file.size <= maxFileSizeMb * 1024 * 1024
  }

  async function resolvedRelatedCollection(): Promise<string> {
    return resolveAttachedFilesCollection(parentName(), field())
  }

  function nestedFileFromUpload(
    file: File,
    uploaded: Awaited<ReturnType<typeof uploadFile>>,
  ): Record<string, unknown> {
    return {
      id: uploaded.id,
      filename_download: uploaded.filename_download ?? file.name,
      type: uploaded.type ?? file.type,
      filesize: uploaded.filesize ?? file.size,
      title: uploaded.title ?? file.name,
      created_on: uploaded.created_on ?? undefined,
      uploaded_by: uploaded.uploaded_by ?? undefined,
    }
  }

  async function uploadSingleFile(
    file: File,
    parentFk: string | null,
    relatedCollection: string,
  ): Promise<ReturnType<FilesHandle['getFiles']>[number]> {
    const currentParentId = parentId()
    const hasParent =
      currentParentId !== undefined &&
      currentParentId !== null &&
      currentParentId !== ''
    const uploaded = await uploadFile(
      file,
      isFilesAssetCollection(relatedCollection) && hasParent && parentName()
        ? { collection: parentName()!, recordId: currentParentId as string | number }
        : undefined,
    )
    const fileId = uploaded.id
    const nestedFile = nestedFileFromUpload(file, uploaded)

    // Shared Files object: the asset row itself is attached to the parent record.
    if (isFilesAssetCollection(relatedCollection)) {
      return {
        id: fileId,
        ...nestedFile,
      }
    }

    // Stage mode (new parent): upload asset only; nest junction on parent create.
    if (!hasParent) {
      return {
        id: `temp-${crypto.randomUUID()}`,
        [FILES_JUNCTION_FILE_ID_FIELD]: nestedFile,
      }
    }

    const payload: Record<string, unknown> = { [FILES_JUNCTION_FILE_ID_FIELD]: fileId }
    if (parentFk) {
      payload[parentFk] = currentParentId
    }

    const junction = await bridgeCreateItem(relatedCollection, payload)

    return {
      id: String((junction as Record<string, unknown>).id ?? ''),
      [FILES_JUNCTION_FILE_ID_FIELD]: nestedFile,
    }
  }

  async function uploadFilesFromList(fileList: FileList | File[] | null | undefined): Promise<void> {
    if (!fileList) return

    const relatedCollection = await resolvedRelatedCollection()
    if (!relatedCollection) {
      toast.add({
        severity: 'error',
        summary: t('common.error', 'Error'),
        detail: t(
          'filePreview.uploadConfigError',
          'File field is not configured with a related collection.',
        ),
        life: 6000,
      })
      return
    }

    const constraints = await uploadConstraints()
    const selectedFiles = Array.from(fileList).filter((file) =>
      fileMatchesAllowedMimeTypes(file, constraints.allowedMimeTypes),
    )
    const oversized = selectedFiles.filter(
      (file) => !fileWithinMaxSize(file, constraints.maxFileSizeMb),
    )
    if (oversized.length) {
      toast.add({
        severity: 'warn',
        summary: t('filePreview.fileTooLarge', 'File too large'),
        detail: t(
          'filePreview.fileTooLargeDetail',
          'Maximum size is {size} MB.',
          { size: constraints.maxFileSizeMb ?? 0 },
        ),
        life: 6000,
      })
    }
    const sizedFiles = selectedFiles.filter((file) =>
      fileWithinMaxSize(file, constraints.maxFileSizeMb),
    )
    const filesToUpload = filesSettings(field())?.multiple
      ? sizedFiles
      : sizedFiles.slice(0, 1)
    if (!filesToUpload.length) return

    uploadLoading.value = true
    try {
      const parentFk =
        parentName() && !isFilesAssetCollection(relatedCollection)
          ? await findParentFkField(relatedCollection, parentName()!)
          : null

      const uploadedItems = await Promise.all(
        filesToUpload.map((file) => uploadSingleFile(file, parentFk, relatedCollection)),
      )

      filesStore.setFiles(
        field().field,
        filesSettings(field())?.multiple
          ? [...files(), ...uploadedItems]
          : uploadedItems,
      )
    } catch (err) {
      console.error('Upload failed:', err)
      toast.add({
        severity: 'error',
        summary: t('filePreview.uploadFailed', 'Upload failed'),
        detail:
          err instanceof Error
            ? err.message
            : t('filePreview.uploadFailedDetail', 'Could not upload the file.'),
        life: 8000,
      })
    } finally {
      uploadLoading.value = false
    }
  }

  /** Link existing file asset(s) without uploading a new binary. */
  async function linkExistingFiles(
    assets: Array<Record<string, unknown>>,
  ): Promise<void> {
    const selected = assets
      .map((asset) => {
        const id = asset.id == null ? '' : String(asset.id)
        if (!id) return null
        return { ...asset, id }
      })
      .filter(Boolean) as Array<Record<string, unknown> & { id: string }>
    if (!selected.length) return

    const relatedCollection = await resolvedRelatedCollection()
    if (!relatedCollection) {
      toast.add({
        severity: 'error',
        summary: t('common.error', 'Error'),
        detail: t(
          'filePreview.uploadConfigError',
          'File field is not configured with a related collection.',
        ),
        life: 6000,
      })
      return
    }

    const multiple = Boolean(filesSettings(field())?.multiple)
    const toLink = multiple ? selected : selected.slice(0, 1)

    uploadLoading.value = true
    try {
      const currentParentId = parentId()
      const hasParent =
        currentParentId !== undefined &&
        currentParentId !== null &&
        currentParentId !== ''

      // Shared files collection: persist secondary parent links (do not move).
      if (isFilesAssetCollection(relatedCollection)) {
        if (!hasParent || !parentName()) {
          toast.add({
            severity: 'warn',
            summary: t('common.warning', 'Warning'),
            detail: t(
              'filePreview.linkNeedsSavedRecord',
              'Save the record before linking files.',
            ),
            life: 5000,
          })
          return
        }

        const existingIds = new Set(
          files()
            .map((item) => fileItemId(item))
            .filter(Boolean) as string[],
        )
        const linked: FileItem[] = []
        for (const asset of toLink) {
          if (existingIds.has(asset.id)) continue
          const shaped = await linkFileToRecord(asset.id, {
            collection: parentName()!,
            recordId: currentParentId!,
          })
          linked.push({
            id: String(shaped.id || asset.id),
            filename_download:
              shaped.filename_download ?? asset.filename_download,
            type: shaped.type ?? asset.type,
            filesize: shaped.filesize ?? asset.filesize,
            title: shaped.title ?? asset.title,
            created_on: shaped.created_on ?? asset.created_on,
            uploaded_by: shaped.uploaded_by ?? asset.uploaded_by,
            width: asset.width,
            height: asset.height,
          })
        }

        if (linked.length) {
          filesStore.setFiles(
            field().field,
            multiple ? [...files(), ...linked] : linked,
          )
          toast.add({
            severity: 'success',
            summary: t('common.success', 'Success'),
            detail: t(
              'filePreview.linkSuccess',
              'File linked to this record.',
            ),
            life: 3000,
          })
        }
        return
      }

      // Junction Attachments: create link-shaped rows pointing at existing assets.
      const parentFk =
        parentName() && hasParent
          ? await findParentFkField(relatedCollection, parentName()!)
          : null

      const linkedItems: FileItem[] = []
      for (const asset of toLink) {
        const nestedFile = {
          id: asset.id,
          filename_download: asset.filename_download,
          type: asset.type,
          filesize: asset.filesize,
          title: asset.title,
          created_on: asset.created_on,
          uploaded_by: asset.uploaded_by,
          width: asset.width,
          height: asset.height,
        }

        if (!hasParent) {
          linkedItems.push({
            id: `temp-${crypto.randomUUID()}`,
            [FILES_JUNCTION_FILE_ID_FIELD]: nestedFile,
          })
          continue
        }

        const payload: Record<string, unknown> = {
          [FILES_JUNCTION_FILE_ID_FIELD]: asset.id,
        }
        if (parentFk) payload[parentFk] = currentParentId

        const junction = await bridgeCreateItem(relatedCollection, payload)
        linkedItems.push({
          id: String((junction as Record<string, unknown>).id ?? ''),
          [FILES_JUNCTION_FILE_ID_FIELD]: nestedFile,
        })
      }

      filesStore.setFiles(
        field().field,
        multiple ? [...files(), ...linkedItems] : linkedItems,
      )
    } catch (err) {
      console.error('Link existing file failed:', err)
      toast.add({
        severity: 'error',
        summary: t('filePreview.linkFailed', 'Link failed'),
        detail:
          err instanceof Error
            ? err.message
            : t('filePreview.linkFailedDetail', 'Could not link the selected file.'),
        life: 8000,
      })
    } finally {
      uploadLoading.value = false
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  function promptDeleteFile(item: FileItem): void {
    setTimeout(() => {
      confirm.require({
        message: t('filePreview.deleteConfirmMessage', `Remove attached file "{name}" ?`, { name: fileItemName(item) }),
        header: t('filePreview.deleteConfirmHeader', 'Remove Attachment'),
        icon: 'pi pi-exclamation-triangle',
        rejectProps: {
          label: t('common.cancel', 'Cancel'),
          severity: 'secondary',
          text: true,
        },
        acceptProps: {
          label: t('common.remove', 'Remove'),
          severity: 'danger',
        },
        accept: () => void doDeleteFile(item),
      })
    }, 0)
  }

  async function doDeleteFile(item: FileItem): Promise<void> {
    const assetId = fileItemId(item)
    const rowId = item.id
    if (!rowId && !assetId) return

    const relatedCollection = await resolvedRelatedCollection()
    if (!relatedCollection) return

    const key = String(rowId ?? assetId)
    deleteLoading[key] = key
    try {
      const isTemp = typeof rowId === 'string' && rowId.startsWith('temp-')
      const currentParentId = parentId()
      const hasParent =
        currentParentId !== undefined &&
        currentParentId !== null &&
        currentParentId !== ''
      if (!isTemp && hasParent) {
        // Image / single-file M2O: only clear the FK in form state; do not
        // soft-delete the shared files registry row (may be linked elsewhere).
        if (isFilesAssetCollection(relatedCollection) && !isSingleFileField(field())) {
          await deleteFile(
            String(assetId ?? rowId),
            parentName()
              ? { collection: parentName()!, recordId: currentParentId! }
              : null,
          )
        } else if (!isFilesAssetCollection(relatedCollection)) {
          await bridgeDeleteItem(relatedCollection, rowId ?? assetId!)
        }
      }
      filesStore.setFiles(
        field().field,
        files().filter((f) => f.id !== rowId && fileItemId(f) !== assetId),
      )
    } catch (err) {
      console.error('Delete failed:', err)
      toast.add({
        severity: 'error',
        summary: t('filePreview.deleteFailed', 'Remove failed'),
        detail:
          err instanceof Error
            ? err.message
            : t('filePreview.deleteFailedDetail', 'Could not remove the attached file.'),
        life: 8000,
      })
    } finally {
      deleteLoading[key] = null
    }
  }

  // ── Action menu ───────────────────────────────────────────────────────────
  const fileActionMenuItems: Ref<MenuItem[]> = ref([])

  function openFileActionMenu(event: Event, item: FileItem): void {
    const unavailable = fileIsUnavailable(item)
    fileActionMenuItems.value = [
      {
        label: t('common.preview', 'Preview'),
        icon: 'pi pi-eye',
        disabled: unavailable,
        command: () => openPreview(item),
      },
      {
        label: t('common.download', 'Download'),
        icon: 'pi pi-download',
        disabled: unavailable,
        command: () => { window.open(safeFileDownloadUrl(item), '_blank') },
      },
      { separator: true },
      {
        label: t('common.delete', 'Delete'),
        icon: 'pi pi-trash',
        class: 'text-red-500',
        command: () => promptDeleteFile(item),
      },
    ]
    toggleMenu(event)
  }

  /** Link CoreEngine file assets dropped onto this field (shared Files or junction). */
  async function linkDraggedCoreEngineFiles(
    payloads: CoreEngineFileDragPayload[],
  ): Promise<void> {
    if (!payloads.length) return
    await linkExistingFiles(
      payloads.map((payload) => ({
        id: payload.id,
        filename_download: payload.filename_download,
        type: payload.type,
        filesize: payload.filesize,
        title: payload.title,
        created_on: payload.created_on,
        uploaded_by: payload.uploaded_by,
        width: payload.width,
        height: payload.height,
      })),
    )
  }

  return {
    uploadLoading,
    deleteLoading,
    previewVisible,
    previewFileData,
    fileActionMenuItems,
    openPreview,
    handleFileUpdated,
    triggerUpload,
    uploadFilesFromList,
    linkExistingFiles,
    linkDraggedCoreEngineFiles,
    promptDeleteFile,
    openFileActionMenu,
  }
}
