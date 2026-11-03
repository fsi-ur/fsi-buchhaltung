import { inflateRawSync } from 'zlib'
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  buildDocumentExportZip,
  documentExportEntryName,
  documentIndexRows,
  parseDocumentExportRequest,
} from '~/server/utils/documentExport/engine'
import { buildDocumentExportCover, buildMergedDocumentExportPdf, jpegOrientationTurn } from '~/server/utils/documentExport/pdf'
import { DOCUMENT_EXPORT_SOURCES } from '~/server/utils/documentExport/registry'
import { EMPTY_DOCUMENT_EXPORT_SCOPE, sourceAmountColumn, sourceColumns, type DocumentExportContext, type DocumentExportItem, type DocumentExportScope, type DocumentExportSource } from '~/server/utils/documentExport/types'
import { DOCUMENT_EXPORT_COST_CENTRE_SCOPE, DOCUMENT_EXPORT_PERMISSIONS, DOCUMENT_EXPORT_SOURCE_KEYS, MAX_DOCUMENT_EXPORT_COUNT } from '~/shared/documentExport'
import { PERMISSIONS } from '~/config/permissions'

// 1×1 transparent PNG
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

/** A made-up source, so the engine is tested independently of receipts. */
const source: DocumentExportSource = {
  title: 'Testexport',
  fileNamePrefix: 'Test',
  noun: { one: 'Vorgang', many: 'Vorgänge' },
  columns: [
    { key: 'date', label: 'Datum', pdfWeight: 1, excelWidth: 12 },
    { key: 'name', label: 'Name', pdfWeight: 2, excelWidth: 30 },
    { key: 'note', label: 'Notiz', excelWidth: 30 },
    { key: 'amount', label: 'Betrag', pdfWeight: 1, excelWidth: 14, align: 'right' },
  ],
  amountColumn: 'amount',
  primaryColumn: 'name',
  formatAmount: value => `${value.toFixed(2)} EUR`,
  load: async () => ({ ok: true, items: [] }),
}

const context: DocumentExportContext = { createdOn: '2026-11-03', association: null, logo: null, scope: EMPTY_DOCUMENT_EXPORT_SCOPE }

function item(overrides: Partial<DocumentExportItem> = {}): DocumentExportItem {
  return {
    id: 1,
    values: { date: '14.10.2026', name: 'Getränke Müller', note: 'Party', amount: '12.50 EUR' },
    label: 'Vorgang 1',
    fileNameParts: ['2026-10-14', 'R-1', 'Getränke Müller'],
    amount: 12.5,
    file: null,
    fileMissing: false,
    details: [{ label: 'Name', value: 'Getränke Müller' }],
    detailTable: { title: 'Positionen', columns: [{ label: 'Text', weight: 1 }], rows: [['Eins']] },
    ...overrides,
  }
}

async function pdfWithPages(count: number, size: [number, number] = [200, 300], rotate = 0) {
  const document = await PDFDocument.create()
  for (let index = 0; index < count; index += 1) document.addPage(size).setRotation(degrees(rotate))
  return Buffer.from(await document.save())
}

/** SOI + an APP1 Exif segment with the given orientation — enough for the orientation parser. */
function jpegHeaderWithOrientation(orientation: number, littleEndian = false) {
  const tiff = Buffer.alloc(26)
  if (littleEndian) {
    tiff.write('II', 0, 'latin1'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4)
    tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(orientation, 18)
  } else {
    tiff.write('MM', 0, 'latin1'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4)
    tiff.writeUInt16BE(1, 8); tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(orientation, 18)
  }
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const header = Buffer.alloc(4)
  header.writeUInt16BE(0xFFE1, 0)
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), header, payload, Buffer.from([0xFF, 0xD9])])
}

/** Reads the entries of a ZIP from its central directory (enough for archives written by buildZip). */
function readZip(data: Buffer) {
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4B, 0x05, 0x06]))
  const count = data.readUInt16LE(end + 10)
  let offset = data.readUInt32LE(end + 16)
  const entries: Array<{ name: string, flags: number, data: Buffer }> = []
  for (let index = 0; index < count; index += 1) {
    const flags = data.readUInt16LE(offset + 8)
    const compressedSize = data.readUInt32LE(offset + 20)
    const nameLength = data.readUInt16LE(offset + 28)
    const localOffset = data.readUInt32LE(offset + 42)
    const name = data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    const start = localOffset + 30 + data.readUInt16LE(localOffset + 26)
    entries.push({ name, flags, data: inflateRawSync(data.subarray(start, start + compressedSize)) })
    offset += 46 + nameLength
  }
  return entries
}

/** Page index each link annotation on `pageIndex` jumps to. */
function linkTargets(document: PDFDocument, pageIndex: number) {
  const annots = document.getPage(pageIndex).node.Annots()
  if (!annots) return []
  const pageRefs = document.getPages().map(page => page.ref.toString())
  return annots.asArray().map((ref) => {
    const annot = document.context.lookup(ref, PDFDict)
    const dest = annot.lookup(PDFName.of('Dest'), PDFArray)
    return pageRefs.indexOf((dest.get(0) as PDFRef).toString())
  })
}

describe('registry', () => {
  it('has a source and permissions for every key, all of them real permissions', () => {
    for (const key of DOCUMENT_EXPORT_SOURCE_KEYS) {
      expect(DOCUMENT_EXPORT_SOURCES[key]).toBeDefined()
      expect(DOCUMENT_EXPORT_PERMISSIONS[key].length).toBeGreaterThan(0)
      for (const permission of DOCUMENT_EXPORT_PERMISSIONS[key]) expect(PERMISSIONS.map(definition => definition.key)).toContain(permission)
    }
  })

  it('declares amount and primary columns that exist, with and without a cost-centre scope', () => {
    const scoped: DocumentExportScope = { costCentre: { ids: [1], label: '100 – Feste' } }
    for (const [key, exportSource] of Object.entries(DOCUMENT_EXPORT_SOURCES)) {
      const scopes = DOCUMENT_EXPORT_COST_CENTRE_SCOPE[key as keyof typeof DOCUMENT_EXPORT_COST_CENTRE_SCOPE]
        ? [EMPTY_DOCUMENT_EXPORT_SCOPE, scoped]
        : [EMPTY_DOCUMENT_EXPORT_SCOPE]
      for (const scope of scopes) {
        const keys = sourceColumns(exportSource, scope).map(column => column.key)
        expect(keys).toContain(exportSource.primaryColumn)
        const amountColumn = sourceAmountColumn(exportSource, scope)
        if (amountColumn) expect(keys).toContain(amountColumn)
      }
    }
  })
})

describe('parseDocumentExportRequest', () => {
  it('accepts a valid request, de-duplicates ids and defaults the options to on', () => {
    expect(parseDocumentExportRequest({ ids: [3, '5', 3], format: 'zip' })).toEqual({
      ok: true,
      request: { ids: [3, 5], format: 'zip', includeCover: true, includeIndex: true, costCentre: null },
    })
  })

  it('keeps explicitly disabled options', () => {
    const parsed = parseDocumentExportRequest({ ids: [1], format: 'pdf', includeCover: false, includeIndex: false })
    expect(parsed.ok && parsed.request).toMatchObject({ includeCover: false, includeIndex: false })
  })

  it.each([
    [{ ids: [1], format: 'xlsx' }],
    [{ ids: [], format: 'pdf' }],
    [{ ids: [0], format: 'pdf' }],
    [{ ids: ['abc'], format: 'pdf' }],
    [{ ids: [1.5], format: 'pdf' }],
    [{ format: 'pdf' }],
    [null],
  ])('rejects %j', (body) => {
    expect(parseDocumentExportRequest(body).ok).toBe(false)
  })

  it('parses an optional cost-centre scope', () => {
    const parsed = parseDocumentExportRequest({ ids: [1], format: 'pdf', costCentre: { id: '7', includeChildren: true } })
    expect(parsed.ok && parsed.request.costCentre).toEqual({ id: 7, includeChildren: true })
    expect(parseDocumentExportRequest({ ids: [1], format: 'pdf', costCentre: { id: 0 } }).ok).toBe(false)
  })

  it('caps the number of records per export', () => {
    const ids = Array.from({ length: MAX_DOCUMENT_EXPORT_COUNT + 1 }, (_, index) => index + 1)
    expect(parseDocumentExportRequest({ ids, format: 'pdf' }).ok).toBe(false)
    expect(parseDocumentExportRequest({ ids: ids.slice(1), format: 'pdf' }).ok).toBe(true)
  })
})

describe('documentExportEntryName', () => {
  it('builds a sortable, unique name from the running number and the name parts', () => {
    const file = { original_name: 'scan.PDF', mime_type: 'application/pdf', data: Buffer.alloc(0) }
    expect(documentExportEntryName(item({ file }), 3, 12)).toBe('003_2026-10-14_R-1_Getränke Müller.pdf')
  })

  it('strips characters that are invalid in file names and skips empty parts', () => {
    const file = { original_name: 'foto.jpeg', mime_type: 'image/jpeg', data: Buffer.alloc(0) }
    expect(documentExportEntryName(item({ file, fileNameParts: ['2026-10-14', 'A/B:7', null] }), 1, 1)).toBe('001_2026-10-14_A-B-7.jpg')
  })

  it('widens the running number for large exports', () => {
    const file = { original_name: 'x.png', mime_type: 'image/png', data: Buffer.alloc(0) }
    expect(documentExportEntryName(item({ file, fileNameParts: ['2026-10-14'] }), 7, 1200)).toBe('0007_2026-10-14.png')
  })
})

describe('buildDocumentExportZip', () => {
  const withFile = item({ id: 1, file: { original_name: 'a.pdf', mime_type: 'application/pdf', data: Buffer.from('%PDF-a') } })
  const withoutFile = item({ id: 2, fileNameParts: ['2026-10-15'] })

  it('stores the original bytes under UTF-8 flagged names, plus the Excel index', () => {
    const result = buildDocumentExportZip({ source, items: [withFile, withoutFile], includeIndex: true, modifiedAt: '2026-11-03 12:00:00', context })
    expect(result.ok).toBe(true)
    const entries = readZip((result as { data: Buffer }).data)
    expect(entries.map(entry => entry.name)).toEqual(['001_2026-10-14_R-1_Getränke Müller.pdf', 'Test_Übersicht_2026-11-03.xlsx'])
    expect(entries[0]!.data.toString()).toBe('%PDF-a')
    expect(entries[0]!.flags & 0x0800).toBe(0x0800)
  })

  it('refuses an archive that would be empty', () => {
    expect(buildDocumentExportZip({ source, items: [withoutFile], includeIndex: false, modifiedAt: '2026-11-03 12:00:00', context }).ok).toBe(false)
  })

  it('lists the Excel columns and why a record has no file', () => {
    const rows = documentIndexRows(source, [withFile, withoutFile, item({ fileMissing: true })], ['001.pdf', null, null], EMPTY_DOCUMENT_EXPORT_SCOPE)
    expect(rows[0]).toEqual(['1', '14.10.2026', 'Getränke Müller', 'Party', '12.50 EUR', '001.pdf'])
    expect(rows.map(row => row.at(-1))).toEqual(['001.pdf', 'Kein Dokument hinterlegt', 'Datei fehlt im Speicher'])
  })
})

describe('buildMergedDocumentExportPdf', () => {
  const items = async () => [
    item({ id: 1, label: 'PDF', file: { original_name: 'a.pdf', mime_type: 'application/pdf', data: await pdfWithPages(2) } }),
    item({ id: 2, label: 'Bild', file: { original_name: 'b.png', mime_type: 'image/png', data: PNG_1X1 } }),
    item({ id: 3, label: 'Ohne' }),
    item({ id: 4, label: 'Kaputt', file: { original_name: 'kaputt.pdf', mime_type: 'application/pdf', data: Buffer.from('not a pdf') } }),
    item({ id: 5, label: 'Kaputtes Bild', file: { original_name: 'kaputt.png', mime_type: 'image/png', data: Buffer.from('nope') } }),
  ]

  it('merges documents, images and placeholders in order after the overview', async () => {
    const withCover = await PDFDocument.load(await buildMergedDocumentExportPdf({ source, items: await items(), includeCover: true, context }))
    const withoutCover = await PDFDocument.load(await buildMergedDocumentExportPdf({ source, items: await items(), includeCover: false, context }))

    // 2 PDF pages + 1 image page + 3 single-page placeholders (no file, corrupt PDF, corrupt image)
    expect(withoutCover.getPageCount()).toBe(6)
    expect(withCover.getPageCount()).toBe(7)
  })

  it('puts every page on upright A4 portrait, whatever the source size or rotation', async () => {
    const mixed = [
      item({ id: 1, file: { original_name: 'a4.pdf', mime_type: 'application/pdf', data: await pdfWithPages(1, [595.28, 841.89]) } }),
      item({ id: 2, file: { original_name: 'quer.pdf', mime_type: 'application/pdf', data: await pdfWithPages(1, [842, 595]) } }),
      item({ id: 3, file: { original_name: 'gedreht.pdf', mime_type: 'application/pdf', data: await pdfWithPages(2, [842, 595], 90) } }),
      item({ id: 4, file: { original_name: 'riesig.pdf', mime_type: 'application/pdf', data: await pdfWithPages(1, [1600, 2133], 270) } }),
      item({ id: 5, file: { original_name: 'b.png', mime_type: 'image/png', data: PNG_1X1 } }),
    ]
    const merged = await PDFDocument.load(await buildMergedDocumentExportPdf({ source, items: mixed, includeCover: true, context }))
    expect(merged.getPageCount()).toBe(1 + 1 + 1 + 2 + 1 + 1)
    for (const page of merged.getPages()) {
      expect(page.getRotation().angle).toBe(0)
      expect(Math.abs(page.getWidth() - 595.28)).toBeLessThan(1)
      expect(Math.abs(page.getHeight() - 841.89)).toBeLessThan(1)
    }
  })

  it('links every overview row to the first page of its record', async () => {
    const merged = await PDFDocument.load(await buildMergedDocumentExportPdf({ source, items: await items(), includeCover: true, context }))
    // cover = page 0; records start at 1 (2 pages), 3, 4, 5, 6
    expect(linkTargets(merged, 0)).toEqual([1, 3, 4, 5, 6])
  })

  it('adds a bookmark per record', async () => {
    const merged = await PDFDocument.load(await buildMergedDocumentExportPdf({ source, items: await items(), includeCover: true, context }))
    const outlines = merged.catalog.lookup(PDFName.of('Outlines'), PDFDict)
    expect(outlines.get(PDFName.of('Count'))?.toString()).toBe('6')
  })

  it('accounts for a multi-page overview in page numbers and links', async () => {
    const many = Array.from({ length: 90 }, (_, index) => item({ id: index + 1, label: `Nr ${index + 1}` }))
    const merged = await PDFDocument.load(await buildMergedDocumentExportPdf({ source, items: many, includeCover: true, context }))
    const { pageCount } = buildDocumentExportCover({ source, items: many, startPages: many.map((_, index) => 100 + index), totalPages: 999, context })
    expect(pageCount).toBeGreaterThan(1)
    expect(merged.getPageCount()).toBe(pageCount + many.length)
    const targets = Array.from({ length: pageCount }, (_, page) => linkTargets(merged, page)).flat()
    expect(targets).toEqual(many.map((_, index) => pageCount + index))
  })
})

describe('jpegOrientationTurn', () => {
  it.each([
    [1, 0], [2, 0], [3, 180], [4, 180], [5, 90], [6, 90], [7, 270], [8, 270],
  ])('maps EXIF orientation %i to a %i° clockwise turn', (orientation, turn) => {
    expect(jpegOrientationTurn(jpegHeaderWithOrientation(orientation))).toBe(turn)
    expect(jpegOrientationTurn(jpegHeaderWithOrientation(orientation, true))).toBe(turn)
  })

  it('treats non-JPEG data and JPEGs without EXIF as upright', () => {
    expect(jpegOrientationTurn(PNG_1X1)).toBe(0)
    expect(jpegOrientationTurn(Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]))).toBe(0)
    expect(jpegOrientationTurn(Buffer.alloc(0))).toBe(0)
  })
})

describe('cost-centre scope', () => {
  /** A source whose overview gains a share column within a scope, like the receipts source. */
  const scopedSource: DocumentExportSource = {
    ...source,
    columns: scope => [
      ...sourceColumns(source, EMPTY_DOCUMENT_EXPORT_SCOPE),
      ...(scope.costCentre ? [{ key: 'share', label: 'Anteil', pdfWeight: 1, excelWidth: 14, align: 'right' as const }] : []),
    ],
    amountColumn: scope => (scope.costCentre ? 'share' : 'amount'),
    overviewNotes: scope => (scope.costCentre ? ['Nur der Anteil wird summiert.'] : []),
  }
  const scopedContext: DocumentExportContext = { ...context, scope: { costCentre: { ids: [7, 8], label: '100 – Feste (inkl. untergeordneter Kostenstellen)' } } }
  const splitItem = item({ amount: 4, values: { date: '14.10.2026', name: 'Split', note: '', amount: '10.00 EUR', share: '4.00 EUR' } })

  it('adds the scope columns to the Excel index and names the cost centre', () => {
    const rows = documentIndexRows(scopedSource, [splitItem], [null], scopedContext.scope)
    expect(rows[0]).toEqual(['1', '14.10.2026', 'Split', '', '10.00 EUR', '4.00 EUR', 'Kein Dokument hinterlegt'])
    const result = buildDocumentExportZip({ source: scopedSource, items: [splitItem], includeIndex: true, modifiedAt: '2026-11-03 12:00:00', context: scopedContext })
    expect(result.ok).toBe(true)
  })

  it('builds the overview with the share column and still links every row', async () => {
    const merged = await PDFDocument.load(await buildMergedDocumentExportPdf({ source: scopedSource, items: [splitItem, item({ id: 2 })], includeCover: true, context: scopedContext }))
    expect(merged.getPageCount()).toBe(3)
    expect(linkTargets(merged, 0)).toEqual([1, 2])
  })
})
