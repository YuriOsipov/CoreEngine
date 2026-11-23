/**
 * Isolated DocEngine PDF/HTML render worker.
 * Parent may call worker.terminate() on timeout for a hard kill.
 */
import { parentPort, workerData } from 'node:worker_threads'

/**
 * postMessage with a transferable ArrayBuffer copy.
 * Node Buffers often share a pooled ArrayBuffer — transferring that pool
 * throws "Cannot transfer object of unsupported type".
 */
function postOk(result) {
  if (!parentPort) throw new Error('renderWorkerThread must run as a Worker')
  const source = Buffer.isBuffer(result.buffer)
    ? result.buffer
    : Buffer.from(result.buffer ?? [])
  const bytes = new Uint8Array(source.byteLength)
  bytes.set(source)
  parentPort.postMessage(
    {
      ok: true,
      mimeType: result.mimeType,
      filename: result.filename,
      buffer: bytes,
    },
    [bytes.buffer],
  )
}

async function run() {
  if (!parentPort) throw new Error('renderWorkerThread must run as a Worker')
  const input = workerData || {}
  const outputFormat = String(input.outputFormat || 'pdf')
  const template = input.template
  const document = input.document
  const title = String(input.title || 'document')
  const base =
    title
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
      .slice(0, 80) || 'document'

  const {
    generateHtmlFromTemplate,
    generatePdfFromTemplate,
  } = await import('@docengine/pdf-renderer')

  if (outputFormat === 'html') {
    const html = await generateHtmlFromTemplate({
      template,
      document,
      fullDocument: true,
    })
    postOk({
      mimeType: 'text/html;charset=utf-8',
      filename: `${base}.html`,
      buffer: Buffer.from(html, 'utf8'),
    })
    return
  }

  const pdf = await generatePdfFromTemplate({ template, document })
  postOk({
    mimeType: 'application/pdf',
    filename: `${base}.pdf`,
    buffer: Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf),
  })
}

run().catch((error) => {
  if (parentPort) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
