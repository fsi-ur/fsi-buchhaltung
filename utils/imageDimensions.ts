export interface ImageDimensions {
  width: number
  height: number
}

export function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null

  const signatureMatches = bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4E
    && bytes[3] === 0x47

  if (!signatureMatches) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

export function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null

  let offset = 2
  while (offset + 8 < bytes.length) {
    const prefix = bytes[offset]
    const marker = bytes[offset + 1]
    const lengthHigh = bytes[offset + 2]
    const lengthLow = bytes[offset + 3]

    if (
      prefix === undefined
      || marker === undefined
      || lengthHigh === undefined
      || lengthLow === undefined
    ) return null

    if (prefix !== 0xFF) {
      offset += 1
      continue
    }

    if (marker === 0xD9 || marker === 0xDA) break

    const segmentLength = (lengthHigh << 8) | lengthLow
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return null

    const isStartOfFrame = marker >= 0xC0
      && marker <= 0xCF
      && marker !== 0xC4
      && marker !== 0xC8
      && marker !== 0xCC

    if (isStartOfFrame) {
      const heightHigh = bytes[offset + 5]
      const heightLow = bytes[offset + 6]
      const widthHigh = bytes[offset + 7]
      const widthLow = bytes[offset + 8]

      if (
        heightHigh === undefined
        || heightLow === undefined
        || widthHigh === undefined
        || widthLow === undefined
      ) return null

      const height = (heightHigh << 8) | heightLow
      const width = (widthHigh << 8) | widthLow
      if (width <= 0 || height <= 0) return null
      return { width, height }
    }

    offset += 2 + segmentLength
  }

  return null
}

export interface LoadedImageAsset extends ImageDimensions {
  data: Uint8Array
  extension: 'png' | 'jpeg'
  mimeType: string
}

export async function loadImageAsset(url: string): Promise<LoadedImageAsset | null> {
  try {
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) return null

    const blob = await response.blob()
    const mimeType = blob.type.toLowerCase()
    const extension = mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/jpeg' || mimeType === 'image/jpg'
        ? 'jpeg'
        : null

    if (!extension) return null

    const data = new Uint8Array(await blob.arrayBuffer())
    const dimensions = extension === 'png' ? readPngDimensions(data) : readJpegDimensions(data)
    if (!dimensions) return null

    return {
      data,
      extension,
      mimeType: extension === 'png' ? 'image/png' : 'image/jpeg',
      width: dimensions.width,
      height: dimensions.height,
    }
  } catch {
    return null
  }
}
