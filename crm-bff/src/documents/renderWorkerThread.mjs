/**
 * Isolated DocEngine PDF/HTML render worker.
 * Parent may call worker.terminate() on timeout for a hard kill.
 */
import { parentPort, workerData } from 'node:worker_threads'

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
    const buffer = Buffer.from(html, 'utf8')
    parentPort.postMessage(
      {
        ok: true,
        mimeType: 'text/html;charset=utf-8',
        filename: `${base}.html`,
        buffer,
      },
      [buffer.buffer],
    )
    return
  }

  const pdf = await generatePdfFromTemplate({ template, document })
  const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf)
  parentPort.postMessage(
    {
      ok: true,
      mimeType: 'application/pdf',
      filename: `${base}.pdf`,
      buffer,
    },
    [buffer.buffer],
  )
}

run().catch((error) => {
  if (parentPort) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
