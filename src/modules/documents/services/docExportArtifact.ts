import { buildStandaloneDocumentHtml } from './docHtmlPreview'
import { generateDocumentPdfBlob } from '@docengine/editor'
import { uploadFile } from '@/core/graphql/filesProxy'
import type { DocEngineExportMode } from '@/interfaces/documents'

function safeFilenameBase(title: string): string {
  const trimmed = title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').slice(0, 80)
  return trimmed || 'document'
}

/** Build a downloadable PDF or HTML file from a DocEngine document export. */
export async function buildDocumentExportFile(
  doc: Record<string, unknown>,
  options: {
    mode: DocEngineExportMode
    title: string
  },
): Promise<File> {
  const base = safeFilenameBase(options.title)
  if (options.mode === 'html') {
    const html = buildStandaloneDocumentHtml(doc, {
      title: options.title || 'document',
    })
    return new File([html], `${base}.html`, { type: 'text/html;charset=utf-8' })
  }

  const blob = await generateDocumentPdfBlob(doc as never, {
    title: options.title || 'document',
    download: false,
  })
  return new File([blob], `${base}.pdf`, { type: blob.type || 'application/pdf' })
}

export async function uploadDocumentExportArtifact(input: {
  doc: Record<string, unknown>
  mode: DocEngineExportMode
  title: string
  parentCollection: string
  parentId: string
}): Promise<string> {
  const file = await buildDocumentExportFile(input.doc, {
    mode: input.mode,
    title: input.title,
  })
  const uploaded = await uploadFile(file, {
    collection: input.parentCollection,
    recordId: input.parentId,
  })
  return String(uploaded.id)
}
