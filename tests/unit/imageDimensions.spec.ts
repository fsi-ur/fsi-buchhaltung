import { describe, expect, it } from 'vitest'
import { readJpegDimensions, readPngDimensions } from '~/utils/imageDimensions'

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function jpegHeader(width: number, height: number) {
  return new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00,
    0xFF, 0xC0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xFF, height & 0xFF,
    (width >> 8) & 0xFF, width & 0xFF,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ])
}

describe('readPngDimensions', () => {
  it('reads width and height from the IHDR chunk', () => {
    expect(readPngDimensions(pngHeader(640, 360))).toEqual({ width: 640, height: 360 })
  })

  it('rejects data that is not a PNG', () => {
    const bytes = pngHeader(640, 360)
    bytes[0] = 0x00
    expect(readPngDimensions(bytes)).toBeNull()
  })

  it('rejects a truncated header', () => {
    expect(readPngDimensions(new Uint8Array(10))).toBeNull()
  })
})

describe('readJpegDimensions', () => {
  it('reads dimensions from the start-of-frame marker', () => {
    expect(readJpegDimensions(jpegHeader(800, 600))).toEqual({ width: 800, height: 600 })
  })

  it('rejects data without the JPEG start-of-image marker', () => {
    expect(readJpegDimensions(new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBeNull()
  })

  it('returns null when no frame header is present', () => {
    expect(readJpegDimensions(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xD9]))).toBeNull()
  })
})
