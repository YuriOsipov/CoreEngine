import { reactive, ref } from 'vue'
import type { Ref } from 'vue' // used for typed refs below
import type { MenuItem } from 'openvue/menuitem'
import { useToast } from 'openvue/usetoast'
import type { LayoutFieldMetadata } from '@/interfaces'
import {
  bridgeCreateItem,
  bridgeDeleteItem,
} from '@/core/graphql/itemsBridge'
import { uploadFile, deleteFile } from '@/core/graphql/filesProxy'
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
} from '@/core/filesField'
import { filesSettings } from '@/core/fieldHelpers'
import {
  findParentFkField,
  resolveAttachedFilesCollection,
} from '@/modules/entities/services/collectionSchema'

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
  function triggerUpload(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = Boolean(filesSettings(field())?.multiple)
    if (filesSettings(field())?.allowedMimeTypes?.length) {
      input.accept = filesSettings(field())!.allowedMimeTypes!.join(',')
    }
    input.onchange = (e) => void handleFileUpload(e)
    input.click()
  }

  async function handleFileUpload(event: Event): Promise<void> {
    await uploadFilesFromList((event.target as HTMLInputElement).files)
  }

  function fileMatchesAllowedMimeTypes(file: File): boolean {
    const allowedMimeTypes = filesSettings(field())?.allowedMimeTypes ?? []
    if (!allowedMimeTypes.length) return true
    return allowedMimeTypes.some((mime) => file.type === mime || file.type.startsWith(mime))
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

    const selectedFiles = Array.from(fileList).filter(fileMatchesAllowedMimeTypes)
    const filesToUpload = filesSettings(field())?.multiple
      ? selectedFiles
      : selectedFiles.slice(0, 1)
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

      filesStore.setFiles(field().field, [
        ...files(),
        ...uploadedItems,
      ])
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
        if (isFilesAssetCollection(relatedCollection)) {
          await deleteFile(String(assetId ?? rowId))
        } else {
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
    promptDeleteFile,
    openFileActionMenu,
  }
}
