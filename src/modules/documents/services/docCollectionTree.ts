import type {
  CollectionDefinition,
  DocRemoteListCollectionCatalog,
  DocRemoteListCollectionOption,
  DocRemoteListCollectionTreeNode,
} from '@/interfaces'
import { getCachedCollections } from '@/modules/entities/services/collectionSchema'
import { translateCollection } from '@/core/translation'
import {
  groupBookmarkPresetsByCollection,
  loadBookmarkPresets,
} from '@/modules/documents/services/docPresets'

const EXCLUDED_FOLDER_COLLECTIONS = new Set(['main'])

function isFolderCollection(collection: CollectionDefinition): boolean {
  return collection.schema == null
}

function isVisibleDataCollection(collection: CollectionDefinition): boolean {
  const name = collection.collection
  if (EXCLUDED_FOLDER_COLLECTIONS.has(name)) return false
  if (collection.meta?.internal === true) return false
  if (collection.meta?.hidden) return false
  if (isFolderCollection(collection)) return false
  return true
}

async function folderLabel(
  folderId: string,
  foldersById: Map<string, CollectionDefinition>,
): Promise<string> {
  const folder = foldersById.get(folderId)
  if (folder) {
    return translateCollection(folder.collection, folder)
  }
  return translateCollection(folderId, { collection: folderId, meta: {} })
}

function attachPresetChildren(
  collectionNode: DocRemoteListCollectionTreeNode,
  presetsByCollection: Map<string, Awaited<ReturnType<typeof loadBookmarkPresets>>>,
): DocRemoteListCollectionTreeNode {
  const collectionKey = (collectionNode.collectionId ?? collectionNode.id).trim().toLowerCase()
  const presets = presetsByCollection.get(collectionKey) ?? []
  if (presets.length === 0) return collectionNode

  return {
    ...collectionNode,
    children: presets.map((preset) => ({
      id: `preset:${preset.id}`,
      label: preset.bookmark,
      kind: 'preset',
      collectionId: preset.collection,
      presetId: preset.id,
    })),
  }
}

export async function buildRemoteListCollectionTree(): Promise<DocRemoteListCollectionTreeNode[]> {
  const [collections, presets] = await Promise.all([
    getCachedCollections(),
    loadBookmarkPresets(),
  ])
  const presetsByCollection = groupBookmarkPresetsByCollection(presets)

  const foldersById = new Map<string, CollectionDefinition>()
  const folderNodes = new Map<string, DocRemoteListCollectionTreeNode>()

  for (const collection of collections) {
    if (!isFolderCollection(collection)) continue
    foldersById.set(collection.collection, collection)
    folderNodes.set(collection.collection, {
      id: collection.collection,
      label: await translateCollection(collection.collection, collection),
      kind: 'folder',
      children: [],
    })
  }

  const rootCollections: DocRemoteListCollectionTreeNode[] = []

  for (const collection of collections) {
    if (!isVisibleDataCollection(collection)) continue

    const collectionNode = attachPresetChildren(
      {
        id: collection.collection,
        label: await translateCollection(collection.collection, collection),
        kind: 'collection',
        collectionId: collection.collection,
      },
      presetsByCollection,
    )

    const groupKey = collection.meta?.group?.trim()
    if (!groupKey) {
      rootCollections.push(collectionNode)
      continue
    }

    if (!folderNodes.has(groupKey)) {
      folderNodes.set(groupKey, {
        id: groupKey,
        label: await folderLabel(groupKey, foldersById),
        kind: 'folder',
        children: [],
      })
    }

    folderNodes.get(groupKey)?.children?.push(collectionNode)
  }

  const folders = [...folderNodes.values()]
    .filter((node) => (node.children?.length ?? 0) > 0)
    .sort((a, b) => a.label.localeCompare(b.label))

  for (const folder of folders) {
    folder.children = [...(folder.children ?? [])].sort((a, b) =>
      a.label.localeCompare(b.label),
    )
  }

  rootCollections.sort((a, b) => a.label.localeCompare(b.label))

  return [...folders, ...rootCollections]
}

export async function loadRemoteListCollectionCatalog(): Promise<DocRemoteListCollectionCatalog> {
  return {
    bookmarks: [],
    tree: await buildRemoteListCollectionTree(),
  }
}

/** @deprecated Use loadRemoteListCollectionCatalog */
export async function listRemoteListCollectionOptions(): Promise<DocRemoteListCollectionOption[]> {
  const catalog = await loadRemoteListCollectionCatalog()
  const items = new Map<string, DocRemoteListCollectionOption>()

  function walk(nodes: DocRemoteListCollectionTreeNode[]): void {
    for (const node of nodes) {
      if (node.kind === 'collection' && node.collectionId) {
        items.set(node.collectionId, { id: node.collectionId, label: node.label })
      }
      if (node.kind === 'preset' && node.collectionId && node.presetId) {
        items.set(`preset:${node.presetId}`, {
          id: node.collectionId,
          label: `${node.label} (${node.collectionId})`,
        })
      }
      walk(node.children ?? [])
    }
  }

  walk(catalog.tree ?? [])
  return [...items.values()].sort((a, b) => a.label.localeCompare(b.label))
}
