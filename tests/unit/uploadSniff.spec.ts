import { describe, expect, it } from 'vitest'
import { sniffUploadType, validateUploadedFile } from '~/server/utils/files'

describe('upload type sniffing (SEC-21)', () => {
  it('detects PDF, PNG and JPEG from the bytes', () => {
    expect(sniffUploadType(Buffer.from('%PDF-1.7\n...'))).toBe('application/pdf')
    expect(sniffUploadType(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0]))).toBe('image/png')
    expect(sniffUploadType(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))).toBe('image/jpeg')
  })

  it('rejects HTML or scripts that claim to be a PDF', () => {
    const html = { filename: 'beleg.pdf', type: 'application/pdf', data: Buffer.from('<html><script>alert(1)</script>') }
    expect(sniffUploadType(html.data)).toBeNull()
    expect(validateUploadedFile(html)).toBe('Invalid file type')
  })

  it('rejects bytes that do not match an allowed type, whatever the client claims', () => {
    expect(validateUploadedFile({ filename: 'x.png', type: 'image/png', data: Buffer.from('GIF89a') })).toBe('Invalid file type')
  })
})
