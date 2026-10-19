import { deflateSync, inflateSync } from 'zlib'

export type PdfFontName = 'F1' | 'F2' | 'F3' | 'F4' | 'F5'

export type PdfColor = [number, number, number]

export interface PdfText {
  x: number
  y: number
  size: number
  text: string
  font?: PdfFontName
  align?: 'left' | 'right'
  gray?: number
  color?: PdfColor
}

export interface PdfLine {
  x1: number
  y1: number
  x2: number
  y2: number
  width?: number
  gray?: number
  color?: PdfColor
}

export interface PdfRect {
  x: number
  y: number
  width: number
  height: number
  fill?: boolean
  stroke?: boolean
  gray?: number
  color?: PdfColor
  borderGray?: number
  borderColor?: PdfColor
}

export interface PdfImage {
  x: number
  y: number
  width: number
  height: number
  objectName: string
}

export interface PdfLink {
  x: number
  y: number
  width: number
  height: number
  /** 0-based index into the document's pages. */
  targetPage: number
}

export interface PdfImageObject {
  width: number
  height: number
  imageObject: string
  softMaskObject?: string
  /** Horizontal bounds (0-1, fraction of width) of the non-transparent content, for visually centering logos with asymmetric padding. */
  contentBounds?: { left: number, right: number }
}

function escapePdfText(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

const WINANSI_SPECIALS: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86,
  '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C,
  'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B,
  'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
}

const PDF_TRANSLITERATIONS: Record<string, string> = {
  '→': '->', '←': '<-', '↑': '^', '↓': 'v', '↔': '<->', '↵': '<-',
  '⇒': '=>', '⇐': '<=', '⇔': '<=>',
  '✓': '[x]', '✔': '[x]', '☑': '[x]', '☐': '[ ]', '✗': '[-]', '✘': '[-]',
  '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '≡': '=', '∞': 'oo',
  '−': '-', '‐': '-', '‑': '-', '‒': '-', '―': '-', '⁄': '/',
  '′': "'", '″': '"', '‵': "'",
  '★': '*', '☆': '*', '▪': '-', '▫': '-', '●': '•', '○': 'o',
  '▶': '>', '►': '>', '‣': '>', '⁃': '-', '№': 'Nr.',
}

function isDroppableSymbol(code: number) {
  return (code >= 0x2600 && code <= 0x27BF)
    || (code >= 0x2B00 && code <= 0x2BFF)
    || (code >= 0xFE00 && code <= 0xFE0F)
    || (code >= 0x1F000 && code <= 0x1FAFF)
}

const COMBINING_MARKS = /[̀-ͯ]/g

function mapPdfChar(char: string): string {
  const code = char.codePointAt(0) ?? 0

  if (code === 0x09) return ' '
  if (code === 0x0A || code === 0x0D) return char
  if (code < 0x20) return ''
  if (code <= 0x7E) return char
  if (code <= 0x9F) return ''
  if (code === 0x00A0) return ' '
  if (code === 0x00AD) return ''
  if (code <= 0x00FF) return char
  if (WINANSI_SPECIALS[char] !== undefined) return char

  const replacement = PDF_TRANSLITERATIONS[char]
  if (replacement !== undefined) return replacement
  if (isDroppableSymbol(code)) return ''

  const folded = char.normalize('NFD').replace(COMBINING_MARKS, '')
  if (folded && folded !== char) return toPdfText(folded)

  return '?'
}

const PDF_SAFE_TEXT = /^[\n\r\x20-\x7E¡-¬®-ÿ]*$/

export function toPdfText(value: string) {
  const text = String(value ?? '')
  if (PDF_SAFE_TEXT.test(text)) return text

  let out = ''
  for (const char of text) out += mapPdfChar(char)
  return out
}

function encodePdfChar(char: string) {
  const code = WINANSI_SPECIALS[char] ?? char.codePointAt(0) ?? 0x3F
  return String.fromCharCode(code > 0xFF ? 0x3F : code)
}

function encodePdfText(value: string) {
  return [...escapePdfText(toPdfText(value))].map(encodePdfChar).join('')
}

const PREFERRED_BREAK_CHARS = new Set([' ', '.', '-', '_', '@', '/', ',', ';', ':'])

export function wrapText(text: string, maxChars: number) {
  const lines: string[] = []

  const splitLongToken = (token: string) => {
    const tokenLines: string[] = []
    let remaining = token

    while (remaining.length > maxChars) {
      let splitAt = -1
      const searchEnd = Math.min(maxChars, remaining.length - 1)

      for (let index = searchEnd; index >= 0; index -= 1) {
        if (PREFERRED_BREAK_CHARS.has(remaining[index]!)) {
          splitAt = index + 1
          break
        }
      }

      if (splitAt <= 0) splitAt = maxChars

      tokenLines.push(remaining.slice(0, splitAt))
      remaining = remaining.slice(splitAt)
    }

    if (remaining) tokenLines.push(remaining)
    return tokenLines
  }

  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }

    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (next.length > maxChars && current) {
        lines.push(current)
        if (word.length > maxChars) {
          const parts = splitLongToken(word)
          current = parts.pop() || ''
          lines.push(...parts)
        } else {
          current = word
        }
      } else if (next.length > maxChars) {
        const parts = splitLongToken(next)
        current = parts.pop() || ''
        lines.push(...parts)
      } else {
        current = next
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

// Standard Adobe core-font advance widths (per 1000 em units), used by every PDF viewer
// for the built-in Helvetica / Helvetica-Bold fonts we reference without embedding.
// Using the real metrics (rather than a per-character heuristic) is what makes
// centered headings line up pixel-accurately.
const HELVETICA_WIDTHS: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, '\'': 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
  ä: 556, ö: 556, ü: 556, Ä: 667, Ö: 778, Ü: 722, ß: 611,
  '§': 556, '·': 278, '€': 556, '°': 400,
}

const HELVETICA_BOLD_WIDTHS: Record<string, number> = {
  ' ': 278, '!': 333, '"': 474, '#': 556, '$': 556, '%': 889, '&': 722, '\'': 238,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
  ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611, '@': 975,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
  K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 333, '\\': 278, ']': 333, '^': 584, _: 556, '`': 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  '{': 389, '|': 280, '}': 389, '~': 584,
  ä: 611, ö: 611, ü: 611, Ä: 722, Ö: 778, Ü: 722, ß: 611,
  '§': 611, '·': 278, '€': 556, '°': 400,
}

const HELVETICA_EXTRA_WIDTHS: Record<string, number> = {
  '¡': 333, '¢': 556, '£': 556, '¤': 556, '¥': 556, '¦': 260, '¨': 333, '©': 737,
  'ª': 370, '«': 556, '¬': 584, '®': 737, '¯': 333, '±': 584, '²': 333, '³': 333,
  '´': 333, 'µ': 556, '¶': 537, '¸': 333, '¹': 333, 'º': 365, '»': 556,
  '¼': 834, '½': 834, '¾': 834, '¿': 611, 'Æ': 1000, 'Ð': 722, '×': 584, 'Ø': 778,
  'Þ': 667, 'æ': 889, 'ð': 556, '÷': 584, 'ø': 611, 'þ': 556,
  'Œ': 1000, 'œ': 944, 'Š': 667, 'š': 500, 'Ž': 611, 'ž': 500, 'Ÿ': 667, 'ƒ': 556,
  'ˆ': 333, '˜': 333, '‚': 222, '„': 333, '‘': 222, '’': 222, '“': 333, '”': 333,
  '‹': 333, '›': 333, '–': 556, '—': 1000, '†': 556, '‡': 556, '•': 350,
  '…': 1000, '‰': 1000, '™': 1000,
}

const HELVETICA_BOLD_EXTRA_WIDTHS: Record<string, number> = {
  '¡': 333, '¢': 556, '£': 556, '¤': 556, '¥': 556, '¦': 280, '¨': 333, '©': 737,
  'ª': 370, '«': 556, '¬': 584, '®': 737, '¯': 333, '±': 584, '²': 333, '³': 333,
  '´': 333, 'µ': 611, '¶': 556, '¸': 333, '¹': 333, 'º': 365, '»': 556,
  '¼': 834, '½': 834, '¾': 834, '¿': 611, 'Æ': 1000, 'Ð': 722, '×': 584, 'Ø': 778,
  'Þ': 667, 'æ': 889, 'ð': 611, '÷': 584, 'ø': 611, 'þ': 611,
  'Œ': 1000, 'œ': 611, 'Š': 667, 'š': 556, 'Ž': 611, 'ž': 500, 'Ÿ': 667, 'ƒ': 556,
  'ˆ': 333, '˜': 333, '‚': 278, '„': 500, '‘': 278, '’': 278, '“': 500, '”': 500,
  '‹': 333, '›': 333, '–': 556, '—': 1000, '†': 556, '‡': 556, '•': 350,
  '…': 1000, '‰': 1000, '™': 1000,
}

const COURIER_WIDTH = 600

function glyphWidth(char: string, bold: boolean) {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
  const extra = bold ? HELVETICA_BOLD_EXTRA_WIDTHS : HELVETICA_EXTRA_WIDTHS

  const direct = table[char] ?? extra[char]
  if (direct !== undefined) return direct / 1000

  const folded = char.normalize('NFD').replace(COMBINING_MARKS, '')
  if (folded.length === 1 && folded !== char) {
    const base = table[folded] ?? extra[folded]
    if (base !== undefined) return base / 1000
  }

  // Fallback heuristic for characters outside the known metrics table.
  if ('ilIjtfr'.includes(char)) return 0.32
  if ('mwMW@%'.includes(char)) return 0.92
  if (' .,:;|!'.includes(char)) return 0.24
  if ('-_()/[]{}+'.includes(char)) return 0.4
  return 0.58
}

export function estimateTextWidth(text: string, size: number, bold = false, font?: PdfFontName) {
  const printable = toPdfText(text)
  if (font === 'F4') return (printable.length * COURIER_WIDTH * size) / 1000

  const useBold = bold || font === 'F2' || font === 'F5'
  let units = 0
  for (const char of printable) units += glyphWidth(char, useBold)

  return units * size
}

export function wrapTextByWidth(text: string, maxWidth: number, size: number) {
  const lines: string[] = []

  const pushWrappedToken = (token: string) => {
    let remaining = token

    while (remaining) {
      if (estimateTextWidth(remaining, size) <= maxWidth) {
        lines.push(remaining)
        break
      }

      const twoLineCandidates: Array<{ split: number, balance: number }> = []
      for (let index = 0; index < remaining.length; index += 1) {
        if (!PREFERRED_BREAK_CHARS.has(remaining[index]!)) continue

        const candidate = index + 1
        const left = remaining.slice(0, candidate)
        const right = remaining.slice(candidate)
        const leftWidth = estimateTextWidth(left, size)
        const rightWidth = estimateTextWidth(right, size)

        if (leftWidth <= maxWidth && rightWidth <= maxWidth) {
          twoLineCandidates.push({
            split: candidate,
            balance: Math.abs(leftWidth - rightWidth),
          })
        }
      }

      if (twoLineCandidates.length) {
        const bestCandidate = twoLineCandidates.reduce((best, candidate) =>
          candidate.balance < best.balance ? candidate : best
        )
        lines.push(remaining.slice(0, bestCandidate.split))
        remaining = remaining.slice(bestCandidate.split)
        continue
      }

      let splitAt = remaining.length
      while (splitAt > 0 && estimateTextWidth(remaining.slice(0, splitAt), size) > maxWidth) {
        splitAt -= 1
      }

      if (splitAt <= 0) splitAt = 1

      const preferredSplits: number[] = []
      for (let index = splitAt - 1; index >= 0; index -= 1) {
        if (PREFERRED_BREAK_CHARS.has(remaining[index]!)) {
          preferredSplits.push(index + 1)
        }
      }

      const twoLineSplit = preferredSplits.find(candidate =>
        estimateTextWidth(remaining.slice(candidate), size) <= maxWidth
      )

      const finalSplit = twoLineSplit
        ?? preferredSplits[0]
        ?? splitAt

      lines.push(remaining.slice(0, finalSplit))
      remaining = remaining.slice(finalSplit)
    }
  }

  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }

    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (estimateTextWidth(next, size) <= maxWidth) {
        current = next
        continue
      }

      if (current) {
        lines.push(current)
        current = ''
      }

      if (estimateTextWidth(word, size) <= maxWidth) {
        current = word
      } else {
        pushWrappedToken(word)
      }
    }

    if (current) lines.push(current)
  }

  return lines
}

export function centeredTextBaseline(topY: number, bottomY: number, fontSize: number) {
  return ((topY + bottomY) / 2) - (fontSize * 0.3)
}

function fillColorOp(entry: { gray?: number, color?: PdfColor }) {
  if (!entry.color) return `${entry.gray ?? 0} g`
  return `${entry.color.map(component => Math.min(1, Math.max(0, component))).join(' ')} rg`
}

function strokeColorOp(entry: { gray?: number, color?: PdfColor }) {
  if (!entry.color) return `${entry.gray ?? 0} G`
  return `${entry.color.map(component => Math.min(1, Math.max(0, component))).join(' ')} RG`
}

export function drawText(entries: PdfText[]) {
  return entries.map((entry) => {
    const isBold = entry.font === 'F2' || entry.font === 'F5'
    const x = entry.align === 'right' ? entry.x - estimateTextWidth(entry.text, entry.size, isBold, entry.font) : entry.x
    return `BT ${fillColorOp(entry)} /${entry.font || 'F1'} ${entry.size} Tf 1 0 0 1 ${x} ${entry.y} Tm (${encodePdfText(entry.text)}) Tj ET`
  })
}

export function drawLines(entries: PdfLine[]) {
  return entries.map(entry => `${strokeColorOp(entry)} ${entry.width || 1} w ${entry.x1} ${entry.y1} m ${entry.x2} ${entry.y2} l S`)
}

export function drawRects(entries: PdfRect[]) {
  return entries.map(entry => {
    const border = { gray: entry.borderGray ?? entry.gray, color: entry.borderColor ?? entry.color }
    const commands = [fillColorOp(entry), strokeColorOp(border), `${entry.x} ${entry.y} ${entry.width} ${entry.height} re`]
    if (entry.fill && entry.stroke) commands.push('B')
    else if (entry.fill) commands.push('f')
    else commands.push('S')
    return commands.join(' ')
  })
}

export function drawImages(entries: PdfImage[]) {
  return entries.map(entry => `q ${entry.width} 0 0 ${entry.height} ${entry.x} ${entry.y} cm /${entry.objectName} Do Q`)
}

export function buildImageObject(logo: { mimeType: string, data: Buffer }) {
  const normalized = logo.mimeType.toLowerCase()
  if (normalized === 'image/png') return buildPngImageObject(logo.data)
  if (normalized !== 'image/jpeg' && normalized !== 'image/jpg') return null

  return buildJpegImageObject(logo.data)
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

/** Pixel dimensions of a PNG/JPEG without decoding or re-encoding it, e.g. for sizing embedded images in other formats. */
export function readImageSize(image: { mimeType: string, data: Buffer }): { width: number, height: number } | null {
  const normalized = image.mimeType.toLowerCase()

  if (normalized === 'image/png') {
    if (image.data.length < 24 || !image.data.subarray(0, 8).equals(PNG_SIGNATURE)) return null
    const width = image.data.readUInt32BE(16)
    const height = image.data.readUInt32BE(20)
    return width && height ? { width, height } : null
  }

  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    const info = readJpegSize(image.data)
    return info ? { width: info.width, height: info.height } : null
  }

  return null
}

/** x-position for the image's canvas so its visible content (not the full, possibly asymmetrically padded, canvas) is centered at centerX. */
export function centeredImageX(centerX: number, displayWidth: number, imageObject: PdfImageObject) {
  const bounds = imageObject.contentBounds ?? { left: 0, right: 1 }
  const visualCenterFraction = (bounds.left + bounds.right) / 2
  return centerX - (visualCenterFraction * displayWidth)
}

function buildJpegImageObject(data: Buffer): PdfImageObject | null {
  const info = readJpegSize(data)
  if (!info) return null

  const colorSpace = info.components === 1 ? '/DeviceGray' : '/DeviceRGB'
  return {
    width: info.width,
    height: info.height,
    imageObject: `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >> stream\n${data.toString('binary')}\nendstream`,
  }
}

function readJpegSize(data: Buffer) {
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) return null

  let offset = 2
  while (offset < data.length - 9) {
    while (offset < data.length && data[offset] !== 0xFF) offset += 1
    while (offset < data.length && data[offset] === 0xFF) offset += 1
    if (offset >= data.length) break

    const marker = data[offset]
    offset += 1

    if (marker === undefined) break
    if (marker === 0xD9 || marker === 0xDA) break
    if (offset + 1 >= data.length) break

    const segmentLength = data.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > data.length) break

    const isStartOfFrame = (
      (marker >= 0xC0 && marker <= 0xC3)
      || (marker >= 0xC5 && marker <= 0xC7)
      || (marker >= 0xC9 && marker <= 0xCB)
      || (marker >= 0xCD && marker <= 0xCF)
    )

    if (isStartOfFrame) {
      const height = data.readUInt16BE(offset + 3)
      const width = data.readUInt16BE(offset + 5)
      const components = data[offset + 7]
      if (width > 0 && height > 0 && components !== undefined && components > 0) {
        return { width, height, components }
      }
      break
    }

    offset += segmentLength
  }

  return null
}

const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const PNG_BIT_DEPTHS: Record<number, number[]> = { 0: [8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }

/**
 * Decodes a non-interlaced PNG (truecolor, grayscale, palette — with or without alpha, 8 or 16 bit) into
 * an 8-bit color stream plus an optional soft mask. Screenshots run through an optimizer often come out
 * as palette images, so those matter as much as plain RGB(A).
 */
function buildPngImageObject(data: Buffer): PdfImageObject | null {
  if (data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null

  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  const bitDepth = data[24]!
  const colorType = data[25]!
  const compression = data[26]
  const filter = data[27]
  const interlace = data[28]

  if (!width || !height || compression !== 0 || filter !== 0 || interlace !== 0) return null
  const channels = PNG_CHANNELS[colorType]
  if (!channels || !PNG_BIT_DEPTHS[colorType]!.includes(bitDepth)) return null

  const idatChunks: Buffer[] = []
  let palette: Buffer | null = null
  let transparency: Buffer | null = null
  let offset = 8
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString('ascii', offset + 4, offset + 8)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + length
    if (chunkEnd + 4 > data.length) return null
    if (type === 'IDAT') idatChunks.push(data.subarray(chunkStart, chunkEnd))
    if (type === 'PLTE') palette = data.subarray(chunkStart, chunkEnd)
    if (type === 'tRNS') transparency = data.subarray(chunkStart, chunkEnd)
    if (type === 'IEND') break
    offset = chunkEnd + 4
  }

  if (!idatChunks.length) return null
  if (colorType === 3 && !palette) return null

  let inflated: Buffer
  try {
    inflated = inflateSync(Buffer.concat(idatChunks))
  } catch {
    return null
  }

  const bitsPerPixel = channels * bitDepth
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8))
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  if (inflated.length < (stride + 1) * height) return null

  const rows = unfilterPngScanlines(inflated, stride, height, bytesPerPixel)
  if (!rows) return null

  const gray = colorType === 0 || colorType === 4
  const outColors = gray ? 1 : 3
  const hasAlpha = colorType === 4 || colorType === 6 || (colorType === 3 && !!transparency?.length)
  const maxSample = (1 << bitDepth) - 1

  const sample = (row: Buffer, pixel: number, channel: number) => {
    const index = (pixel * channels) + channel
    if (bitDepth === 8) return row[index]!
    if (bitDepth === 16) return row[index * 2]!
    const bitOffset = index * bitDepth
    const byte = row[bitOffset >> 3]!
    return (byte >> (8 - bitDepth - (bitOffset & 7))) & maxSample
  }

  const colorRows: Buffer[] = []
  const alphaRows: Buffer[] = []

  for (const row of rows) {
    // Leading 0 = PNG "None" filter per row, which is what Predictor 15 expects.
    const color = Buffer.alloc(1 + (width * outColors))
    const alpha = hasAlpha ? Buffer.alloc(1 + width) : null

    for (let pixel = 0; pixel < width; pixel += 1) {
      const target = 1 + (pixel * outColors)
      if (colorType === 3) {
        const entry = sample(row, pixel, 0)
        color[target] = palette![entry * 3] ?? 0
        color[target + 1] = palette![(entry * 3) + 1] ?? 0
        color[target + 2] = palette![(entry * 3) + 2] ?? 0
        if (alpha) alpha[1 + pixel] = transparency![entry] ?? 255
        continue
      }

      for (let channel = 0; channel < outColors; channel += 1) color[target + channel] = sample(row, pixel, channel)
      if (alpha) alpha[1 + pixel] = sample(row, pixel, outColors)
    }

    colorRows.push(color)
    if (alpha) alphaRows.push(alpha)
  }

  const colorData = deflateSync(Buffer.concat(colorRows))
  const alphaData = alphaRows.length ? deflateSync(Buffer.concat(alphaRows)) : null
  const colorSpace = gray ? '/DeviceGray' : '/DeviceRGB'

  return {
    width,
    height,
    imageObject: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${outColors} /BitsPerComponent 8 /Columns ${width} >> /Length ${colorData.length} >> stream\n${colorData.toString('binary')}\nendstream`,
    softMaskObject: alphaData
      ? `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ${width} >> /Length ${alphaData.length} >> stream\n${alphaData.toString('binary')}\nendstream`
      : undefined,
    contentBounds: alphaRows.length ? computeAlphaContentBounds(alphaRows, width) : undefined,
  }
}

/** `rows` are soft-mask rows: a filter byte followed by one alpha byte per pixel. */
function computeAlphaContentBounds(rows: Buffer[], width: number) {
  const ALPHA_THRESHOLD = 16
  let minCol = -1
  let maxCol = -1

  for (let pixel = 0; pixel < width; pixel += 1) {
    const columnHasContent = rows.some(row => (row[1 + pixel] ?? 0) > ALPHA_THRESHOLD)
    if (!columnHasContent) continue
    if (minCol === -1) minCol = pixel
    maxCol = pixel
  }

  if (minCol === -1) return undefined

  return {
    left: minCol / width,
    right: (maxCol + 1) / width,
  }
}

function unfilterPngScanlines(data: Buffer, stride: number, height: number, bytesPerPixel: number) {
  const rows: Buffer[] = []
  let offset = 0

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filterType = data[offset]
    if (filterType === undefined) return null
    offset += 1

    const source = data.subarray(offset, offset + stride)
    if (source.length !== stride) return null
    offset += stride

    const target = Buffer.alloc(stride)
    const previous = rows[rowIndex - 1] ?? Buffer.alloc(stride)

    for (let i = 0; i < stride; i += 1) {
      const left = i >= bytesPerPixel ? target[i - bytesPerPixel]! : 0
      const up = previous[i] ?? 0
      const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] ?? 0 : 0
      const value = source[i] ?? 0

      switch (filterType) {
        case 0:
          target[i] = value
          break
        case 1:
          target[i] = (value + left) & 0xFF
          break
        case 2:
          target[i] = (value + up) & 0xFF
          break
        case 3:
          target[i] = (value + Math.floor((left + up) / 2)) & 0xFF
          break
        case 4:
          target[i] = (value + paethPredictor(left, up, upLeft)) & 0xFF
          break
        default:
          return null
      }
    }

    rows.push(target)
  }

  return rows
}

function paethPredictor(left: number, up: number, upLeft: number) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  if (pb <= pc) return up
  return upLeft
}

export interface PdfNamedImage {
  /** Resource name the content streams use (`/Im2 Do`); `Im1` is reserved for `imageObject`. */
  name: string
  object: PdfImageObject
}

export function buildPdfDocument(params: {
  pages: string[]
  /** The document's logo, available to the content streams as `/Im1`. */
  imageObject?: PdfImageObject | null
  /** Further images, e.g. pictures inside a wiki article. */
  images?: PdfNamedImage[]
  /** Internal jump targets per page, parallel to `pages`. */
  links?: PdfLink[][]
}) {
  const { imageObject = null, links = [] } = params
  const pages = params.pages.length ? params.pages : ['']
  const images: PdfNamedImage[] = [
    ...(imageObject ? [{ name: 'Im1', object: imageObject }] : []),
    ...(params.images ?? []),
  ]

  const firstPageObjectId = 3
  const pageObjectId = (index: number) => firstPageObjectId + (index * 2)
  const contentObjectId = (index: number) => pageObjectId(index) + 1
  const fontRegularId = firstPageObjectId + (pages.length * 2)
  const fontBoldId = fontRegularId + 1
  const fontItalicId = fontRegularId + 2
  const fontMonoId = fontRegularId + 3
  const fontBoldItalicId = fontRegularId + 4

  // Objects are emitted in id order — the xref table is written assuming position N holds object N + 1.
  let nextObjectId = fontBoldItalicId + 1
  const imageIds = images.map(image => ({
    imageId: nextObjectId++,
    softMaskId: image.object.softMaskObject ? nextObjectId++ : null,
  }))

  const xObjectPart = images.length
    ? ` /XObject << ${images.map((image, index) => `/${image.name} ${imageIds[index]!.imageId} 0 R`).join(' ')} >>`
    : ''
  const resources = `<< /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R /F3 ${fontItalicId} 0 R /F4 ${fontMonoId} 0 R /F5 ${fontBoldItalicId} 0 R >>${xObjectPart} >>`
  const kids = pages.map((_, index) => `${pageObjectId(index)} 0 R`).join(' ')

  const objects: string[] = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages.length} >> endobj`,
  ]

  // Annotation objects trail the rest of the file, so their ids stay contiguous with everything already emitted.
  const annotationIds = pages.map((_, index) => (links[index] ?? []).map(() => nextObjectId++))

  pages.forEach((content, index) => {
    const stream = Buffer.from(content, 'binary')
    const pageAnnotationIds = annotationIds[index] ?? []
    const annotsPart = pageAnnotationIds.length
      ? ` /Annots [${pageAnnotationIds.map(id => `${id} 0 R`).join(' ')}]`
      : ''
    objects.push(`${pageObjectId(index)} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595.25 842] /Contents ${contentObjectId(index)} 0 R /Resources ${resources}${annotsPart} >> endobj`)
    objects.push(`${contentObjectId(index)} 0 obj << /Length ${stream.length} >> stream\n${stream.toString('binary')}\nendstream endobj`)
  })

  objects.push(`${fontRegularId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj`)
  objects.push(`${fontBoldId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj`)
  objects.push(`${fontItalicId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >> endobj`)
  objects.push(`${fontMonoId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >> endobj`)
  objects.push(`${fontBoldItalicId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >> endobj`)

  images.forEach((image, index) => {
    const { imageId, softMaskId } = imageIds[index]!
    const smaskReference = softMaskId ? ` /SMask ${softMaskId} 0 R` : ''
    objects.push(`${imageId} 0 obj ${image.object.imageObject.replace('>> stream', `${smaskReference} >> stream`)} endobj`)
    if (softMaskId) objects.push(`${softMaskId} 0 obj ${image.object.softMaskObject} endobj`)
  })

  pages.forEach((_, index) => {
    (links[index] ?? []).forEach((link, linkIndex) => {
      const target = Math.min(Math.max(link.targetPage, 0), pages.length - 1)
      const rect = [link.x, link.y, link.x + link.width, link.y + link.height].join(' ')
      // Zoom 0 keeps whatever magnification the reader is already using.
      objects.push(`${annotationIds[index]![linkIndex]} 0 obj << /Type /Annot /Subtype /Link /Rect [${rect}] /Border [0 0 0] /Dest [${pageObjectId(target)} 0 R /XYZ 0 842 0] >> endobj`)
    })
  })

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'binary'))
    pdf += `${object}\n`
  }

  const xrefOffset = Buffer.byteLength(pdf, 'binary')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return Buffer.from(pdf, 'binary')
}
