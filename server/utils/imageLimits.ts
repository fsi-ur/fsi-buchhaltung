/**
 * Pixel limits for PNGs the server decodes (SEC-11). The PDF builder inflates PNG data in memory;
 * a few KB of compressed zeros can claim gigabytes of pixels, so dimensions are checked before
 * inflating and the inflate output is capped to what the header promises.
 */
export const MAX_IMAGE_DIMENSION = 20_000
export const MAX_IMAGE_PIXELS = 40_000_000

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

/** Width/height from a PNG's IHDR, or null if the data isn't a PNG. */
export function readPngDimensions(data: Buffer): { width: number, height: number } | null {
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (data.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

export function areImageDimensionsAcceptable(width: number, height: number) {
  return width > 0 && height > 0
    && width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION
    && width * height <= MAX_IMAGE_PIXELS
}

export const IMAGE_TOO_LARGE = `Das Bild ist zu groß (höchstens ${MAX_IMAGE_DIMENSION} Pixel je Seite und ${MAX_IMAGE_PIXELS / 1_000_000} Megapixel).`

/** Upload check: a PNG must stay within the pixel limits; other types pass (not decoded here). */
export function checkUploadedImageDimensions(data: Buffer): string | null {
  const dimensions = readPngDimensions(data)
  if (!dimensions) return null
  return areImageDimensionsAcceptable(dimensions.width, dimensions.height) ? null : IMAGE_TOO_LARGE
}
