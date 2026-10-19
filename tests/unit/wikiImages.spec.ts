import { deflateSync, inflateSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { renderArticle } from '~/server/utils/wiki/render'
import { altFromFileName, sniffWikiImageType, validateWikiImage, wikiImageMarkdown } from '~/server/utils/wiki/images'
import { findImageReferencesInText } from '~/shared/wikiImages'
import { buildImageObject, buildPdfDocument } from '~/server/utils/pdf'
import { buildWikiArticlePdf, type WikiPdfArticle } from '~/server/utils/wiki/exportPdf'

function crc32(buffer: Buffer) {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A minimal PNG; `rows` are the unfiltered scanlines (a filter-0 byte is prepended to each). */
function makePng(params: {
  width: number
  height: number
  colorType: number
  bitDepth?: number
  rows: number[][]
  palette?: number[]
  transparency?: number[]
}) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(params.width, 0)
  header.writeUInt32BE(params.height, 4)
  header[8] = params.bitDepth ?? 8
  header[9] = params.colorType
  const raw = Buffer.concat(params.rows.map(row => Buffer.from([0, ...row])))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    ...(params.palette ? [chunk('PLTE', Buffer.from(params.palette))] : []),
    ...(params.transparency ? [chunk('tRNS', Buffer.from(params.transparency))] : []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** The decoded bytes of an image object's stream, without the per-row filter bytes. */
function streamPixels(object: string, width: number, colors: number) {
  const start = object.indexOf('stream\n') + 'stream\n'.length
  const end = object.lastIndexOf('\nendstream')
  const inflated = inflateSync(Buffer.from(object.slice(start, end), 'binary'))
  const rowLength = 1 + (width * colors)
  const pixels: number[] = []
  for (let offset = 0; offset < inflated.length; offset += rowLength) {
    pixels.push(...inflated.subarray(offset + 1, offset + rowLength))
  }
  return pixels
}

describe('renderArticle with bild: images', () => {
  it('renders an uploaded image through the file endpoint', () => {
    const outcome = renderArticle('![Kasse öffnen](bild:12 "Startbildschirm")', { knownImages: [12] })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.html).toContain('<img class="wiki-image" src="/api/files/12" data-wiki-image="12" alt="Kasse öffnen" title="Startbildschirm" loading="lazy" />')
    expect(outcome.images).toEqual([12])
    expect(outcome.text).toContain('Kasse öffnen')
  })

  it('rejects an image that does not belong to the article', () => {
    const outcome = renderArticle('![x](bild:7)', { knownImages: [12] })
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining('gehört nicht zu diesem Artikel') })
  })

  it('rejects a malformed reference', () => {
    const outcome = renderArticle('![x](bild:abc)', { knownImages: [] })
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining('ist ungültig') })
  })

  it('skips the membership check when no image list is given (already validated on publish)', () => {
    const outcome = renderArticle('![x](bild:7)')
    expect(outcome.ok && outcome.images).toEqual([7])
  })

  it('leaves external images alone', () => {
    const outcome = renderArticle('![Logo](https://example.org/logo.png)', { knownImages: [] })
    expect(outcome.ok && outcome.html).toContain('<img src="https://example.org/logo.png" alt="Logo" />')
  })
})

describe('wiki image helpers', () => {
  it('sniffs the type from the bytes, not the declared type', () => {
    expect(sniffWikiImageType(makePng({ width: 1, height: 1, colorType: 2, rows: [[0, 0, 0]] }))).toBe('image/png')
    expect(sniffWikiImageType(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]))).toBe('image/jpeg')
    expect(sniffWikiImageType(Buffer.from('<svg></svg>'))).toBeNull()
  })

  it('refuses anything that is not PNG or JPEG', () => {
    expect(validateWikiImage({ type: 'image/png', data: Buffer.from('<svg onload="x"></svg>') }))
      .toEqual({ ok: false, error: expect.stringContaining('PNG oder JPEG') })
    expect(validateWikiImage(null)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('suggests alt text from meaningful file names only', () => {
    expect(altFromFileName('kasse-oeffnen_neu.png')).toBe('kasse oeffnen neu')
    expect(altFromFileName('image.png')).toBe('')
    expect(altFromFileName('Screenshot (3).png')).toBe('')
  })

  it('builds markdown that cannot break out of the alt text', () => {
    expect(wikiImageMarkdown(5, 'a ] b\n[c')).toBe('![a b c](bild:5)')
  })
})

describe('findImageReferencesInText', () => {
  it('collects every referenced image once', () => {
    expect(findImageReferencesInText('![a](bild:3) text ![b](BILD:12)\n\n![c](bild:3)')).toEqual(new Set([3, 12]))
  })

  it('counts references in code too, erring on "still used"', () => {
    expect(findImageReferencesInText('`![a](bild:4)`')).toEqual(new Set([4]))
    expect(findImageReferencesInText(null)).toEqual(new Set())
  })
})

describe('PNG embedding', () => {
  it('embeds RGB without a soft mask', () => {
    const object = buildImageObject({ mimeType: 'image/png', data: makePng({ width: 2, height: 1, colorType: 2, rows: [[255, 0, 0, 0, 0, 255]] }) })
    expect(object?.softMaskObject).toBeUndefined()
    expect(object && streamPixels(object.imageObject, 2, 3)).toEqual([255, 0, 0, 0, 0, 255])
  })

  it('splits RGBA into color and soft mask', () => {
    const object = buildImageObject({ mimeType: 'image/png', data: makePng({ width: 1, height: 1, colorType: 6, rows: [[10, 20, 30, 128]] }) })
    expect(object && streamPixels(object.imageObject, 1, 3)).toEqual([10, 20, 30])
    expect(object?.softMaskObject && streamPixels(object.softMaskObject, 1, 1)).toEqual([128])
  })

  it('expands palette images, including sub-byte indices and tRNS alpha', () => {
    const object = buildImageObject({
      mimeType: 'image/png',
      data: makePng({
        width: 3,
        height: 1,
        colorType: 3,
        bitDepth: 2,
        palette: [255, 0, 0, 0, 255, 0, 0, 0, 255],
        transparency: [0],
        rows: [[0b00011000]], // indices 0, 1, 2
      }),
    })
    expect(object && streamPixels(object.imageObject, 3, 3)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255])
    expect(object?.softMaskObject && streamPixels(object.softMaskObject, 3, 1)).toEqual([0, 255, 255])
  })

  it('embeds grayscale as DeviceGray and reduces 16-bit samples to 8 bits', () => {
    const object = buildImageObject({
      mimeType: 'image/png',
      data: makePng({ width: 2, height: 1, colorType: 0, bitDepth: 16, rows: [[0x12, 0x34, 0xAB, 0xCD]] }),
    })
    expect(object?.imageObject).toContain('/ColorSpace /DeviceGray')
    expect(object && streamPixels(object.imageObject, 2, 1)).toEqual([0x12, 0xAB])
  })

  it('declines interlaced images instead of misdrawing them', () => {
    const data = makePng({ width: 1, height: 1, colorType: 2, rows: [[0, 0, 0]] })
    data[28] = 1
    expect(buildImageObject({ mimeType: 'image/png', data })).toBeNull()
  })
})

describe('buildPdfDocument with several images', () => {
  it('keeps every object at the offset its xref entry names', () => {
    const rgba = buildImageObject({ mimeType: 'image/png', data: makePng({ width: 1, height: 1, colorType: 6, rows: [[0, 0, 0, 255]] }) })!
    const rgb = buildImageObject({ mimeType: 'image/png', data: makePng({ width: 1, height: 1, colorType: 2, rows: [[0, 0, 0]] }) })!
    const pdf = buildPdfDocument({
      pages: ['q 1 0 0 1 0 0 cm /Im1 Do Q', ''],
      imageObject: rgba,
      images: [{ name: 'Im2', object: rgb }, { name: 'Im3', object: rgba }],
      links: [[{ x: 0, y: 0, width: 10, height: 10, targetPage: 1 }], []],
    }).toString('binary')

    const xref = pdf.slice(pdf.lastIndexOf('xref\n'))
    const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map(match => Number(match[1]))
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset, offset + 12)).toMatch(new RegExp(`^${index + 1} 0 obj`))
    })
    expect(pdf).toMatch(/\/XObject << \/Im1 \d+ 0 R \/Im2 \d+ 0 R \/Im3 \d+ 0 R >>/)
  })
})

describe('buildWikiArticlePdf', () => {
  const article: WikiPdfArticle = {
    id: 1,
    title: 'Kasse',
    summary: '',
    markdown: 'Vorher\n\n![Start](bild:4)\n\n1. Schritt ![Detail](bild:4)\n\n![Fehlt](bild:9)',
    checklists: [],
    depth: 0,
    reviewedAt: null,
    publishedAt: null,
  }

  it('draws uploaded images and falls back to a placeholder for missing ones', () => {
    const png = makePng({ width: 4, height: 2, colorType: 2, rows: [Array(12).fill(200), Array(12).fill(100)] })
    const pdf = buildWikiArticlePdf({
      article,
      spaceTitle: 'Handbuch',
      association: null,
      images: new Map([[4, { mimeType: 'image/png', data: png }]]),
    }).toString('binary')

    // One image object, drawn twice
    expect(pdf.match(/\/Im2 Do/g)).toHaveLength(2)
    expect(pdf).not.toContain('/Im3')
    expect(pdf).toContain('[Bild: Fehlt]')
  })
})
