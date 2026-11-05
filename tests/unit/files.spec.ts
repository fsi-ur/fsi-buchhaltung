import { describe, expect, it } from 'vitest'
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_SIZE, validateUploadedFile } from '~/server/utils/files'

/** A buffer of `size` bytes starting with the magic bytes of `type` (the content is sniffed). */
function bytesOf(type: string, size = 10) {
  const data = Buffer.alloc(size)
  if (type === 'application/pdf') Buffer.from('%PDF-').copy(data)
  else if (type === 'image/png') Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(data)
  else Buffer.from([0xFF, 0xD8, 0xFF]).copy(data)
  return data
}

// tests/setup/unit-env.ts pins MAX_UPLOAD_MB to 5, so the size limit is deterministic.
describe('validateUploadedFile', () => {
  it('derives the size limit from MAX_UPLOAD_MB', () => {
    expect(MAX_UPLOAD_SIZE).toBe(5 * 1024 * 1024)
  })

  it.each(ALLOWED_UPLOAD_MIME)('accepts %s', (type) => {
    expect(validateUploadedFile({ filename: 'beleg', type, data: bytesOf(type) })).toBeNull()
  })

  it.each([
    ['application/zip'],
    ['text/html'],
    ['image/svg+xml'],
    ['application/octet-stream'],
    [''],
  ])('rejects the type %s', (type) => {
    expect(validateUploadedFile({ filename: 'x', type, data: Buffer.alloc(10) })).toBe('Invalid file type')
  })

  it('rejects a file without a declared type', () => {
    expect(validateUploadedFile({ filename: 'x', data: Buffer.alloc(10) })).toBe('Invalid file type')
  })

  it('rejects a file over the limit but accepts one exactly at it', () => {
    expect(validateUploadedFile({ type: 'application/pdf', data: bytesOf('application/pdf', MAX_UPLOAD_SIZE + 1) }))
      .toBe('File too large')
    expect(validateUploadedFile({ type: 'application/pdf', data: bytesOf('application/pdf', MAX_UPLOAD_SIZE) }))
      .toBeNull()
  })

  // An absent file is only an error where the caller says it is required
  it('treats an absent file as valid unless a required message is given', () => {
    expect(validateUploadedFile(null)).toBeNull()
    expect(validateUploadedFile(null, 'Beleg fehlt')).toBe('Beleg fehlt')
  })
})
