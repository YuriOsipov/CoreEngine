import { describe, expect, it } from 'vitest'
import { parseFlowResponseContract } from './flowResponseContract'

describe('parseFlowResponseContract', () => {
  it('reads a wrapped PascalCase sync body', async () => {
    const parsed = parseFlowResponseContract(
      {
        ok: true,
        handler: 'http',
        result: {
          Success: true,
          Message: 'Quote sent.',
          FileName: 'note.txt',
          Data: 'data:text/plain;base64,aGk=',
        },
      },
    )
    expect(parsed?.success).toBe(true)
    expect(parsed?.message).toBe('Quote sent.')
    expect(parsed?.file?.name).toBe('note.txt')
    expect(parsed?.file?.type).toBe('text/plain')
    expect(await parsed?.file?.text()).toBe('hi')
  })

  it('accepts camelCase aliases and a raw base64 payload', async () => {
    const parsed = parseFlowResponseContract(
      {
        success: false,
        message: 'Upstream rejected the row.',
        fileName: 'quote.pdf',
        data: 'aGk=',
      },
    )
    expect(parsed?.success).toBe(false)
    expect(parsed?.message).toBe('Upstream rejected the row.')
    expect(parsed?.file?.name).toBe('quote.pdf')
    expect(parsed?.file?.type).toBe('application/pdf')
    expect(await parsed?.file?.text()).toBe('hi')
  })

  it('leaves an empty Message blank and names a missing file response.bin', async () => {
    const parsed = parseFlowResponseContract({
      Success: true,
      Message: '  ',
      Data: 'aGk=',
    })
    expect(parsed?.message).toBe('')
    expect(parsed?.file?.name).toBe('response.bin')
    expect(parsed?.file?.type).toBe('application/octet-stream')
  })

  it('ignores an immediate webhook ack', () => {
    expect(
      parseFlowResponseContract(
        { ok: true, result: { message: 'Workflow got started.' } },
      ),
    ).toBeNull()
  })

  it('ignores an n8n item array', () => {
    expect(
      parseFlowResponseContract(
        { result: [{ Success: true, Message: 'nope' }] },
      ),
    ).toBeNull()
  })

  it('keeps the contract when Data is not decodable', () => {
    const parsed = parseFlowResponseContract(
      { Success: true, Message: 'Sent.', Data: '!!!' },
    )
    expect(parsed).toEqual({ success: true, message: 'Sent.', file: null })
  })
})
