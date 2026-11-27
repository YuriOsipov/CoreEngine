import { describe, expect, it } from 'vitest'
import {
  binaryFlowContract,
  fileNameFromContentDisposition,
  isBinaryFlowContentType,
} from './httpFlowBody.js'

describe('http flow file body', () => {
  it('treats images and pdf as files', () => {
    expect(isBinaryFlowContentType('image/jpeg')).toBe(true)
    expect(isBinaryFlowContentType('image/jpeg; charset=binary')).toBe(true)
    expect(isBinaryFlowContentType('application/pdf')).toBe(true)
    expect(isBinaryFlowContentType('application/json')).toBe(false)
    expect(isBinaryFlowContentType('text/plain')).toBe(false)
  })

  it('reads a filename from Content-Disposition', () => {
    expect(
      fileNameFromContentDisposition('inline; filename="813-536x354.jpg"'),
    ).toBe('813-536x354.jpg')
  })

  it('builds a sync contract from image bytes', () => {
    const body = binaryFlowContract({
      bytes: Buffer.from('hi'),
      contentType: 'image/jpeg',
      contentDisposition: 'inline; filename="813-536x354.jpg"',
      url: 'https://fastly.picsum.photos/id/813/536/354.jpg?hmac=abc',
    })
    expect(body.Success).toBe(true)
    expect(body.FileName).toBe('813-536x354.jpg')
    expect(body.Data).toBe(Buffer.from('hi').toString('base64'))
  })
})
