import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildImageObject } from '~/server/utils/pdf'
import { checkUploadedImageDimensions, readPngDimensions } from '~/server/utils/imageLimits'

function crc32(buffer: Buffer) {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Grayscale 8-bit PNG claiming `width` x `height` with the given (compressed) pixel payload. */
function png(width: number, height: number, idat: Buffer) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('PNG decompression limits (SEC-11)', () => {
  it('decodes a small valid PNG', () => {
    const raw = Buffer.alloc((2 + 1) * 2) // 2x2, filter byte per row
    expect(buildImageObject({ mimeType: 'image/png', data: png(2, 2, deflateSync(raw)) })).not.toBeNull()
  })

  it('rejects oversized dimensions before inflating', () => {
    const bomb = png(50_000, 50_000, deflateSync(Buffer.alloc(1024)))
    expect(readPngDimensions(bomb)).toEqual({ width: 50_000, height: 50_000 })
    expect(checkUploadedImageDimensions(bomb)).not.toBeNull()
    expect(buildImageObject({ mimeType: 'image/png', data: bomb })).toBeNull()
  })

  it('does not inflate more than the header promises', () => {
    // Header says 10x10, but the stream expands to 64 MB.
    const bomb = png(10, 10, deflateSync(Buffer.alloc(64 * 1024 * 1024)))
    expect(bomb.length).toBeLessThan(200_000)
    expect(() => buildImageObject({ mimeType: 'image/png', data: bomb })).not.toThrow()
    expect(buildImageObject({ mimeType: 'image/png', data: bomb })).toBeNull()
  })

  it('accepts normal photos at upload', () => {
    expect(checkUploadedImageDimensions(png(4000, 3000, deflateSync(Buffer.alloc(10))))).toBeNull()
    expect(checkUploadedImageDimensions(Buffer.from([0xFF, 0xD8, 0xFF]))).toBeNull()
  })
})
