import { degrees, PDFDocument, PDFHexString, PDFName, type PDFRef } from 'pdf-lib'
import { PDF_COLORS } from '~/config/pdfColors'
import { wrapTextByWidth, type PdfColor } from '~/server/utils/pdf'
import { createPdfDocumentLayout, PDF_LAYOUT, type PdfDocumentLayout } from '~/server/utils/pdfLayout'
import { compactParts, countLabel, exportFooterLabel, formatExportDate, missingDocumentText, totalAmount } from './engine'
import { sourceAmountColumn, sourceColumns, type DocumentExportContext, type DocumentExportItem, type DocumentExportSource } from './types'

const CELL_PADDING = 4
const LINE_HEIGHT = 11
const SUB_LINE_HEIGHT = 10
const IMAGE_MARGIN = 28

// ---------------------------------------------------------------------------
// Table renderer in the style of the finance analysis PDF
// ---------------------------------------------------------------------------

interface TableColumn {
  label: string
  weight: number
  align?: 'right'
}

interface TableCell {
  text: string
  subLine?: string
  bold?: boolean
  color?: PdfColor
}

interface TableRow {
  cells: Array<string | TableCell>
  bold?: boolean
  /** Accent band (totals) or a warning wash (record without document). */
  tone?: 'band' | 'warning'
  /** Called with the row's rectangle once placed, e.g. to make it a link. */
  onPlaced?: (placement: { pageIndex: number, x: number, y: number, width: number, height: number }) => void
}

function renderSectionTitle(layout: PdfDocumentLayout, title: string) {
  const { contentLeft } = PDF_LAYOUT
  layout.page.texts.push({ x: contentLeft, y: layout.y - 12, size: 12.5, text: title, font: 'F2', color: PDF_COLORS.accent })
  layout.page.rects.push({ x: contentLeft, y: layout.y - 19, width: 34, height: 2, fill: true, color: PDF_COLORS.accent })
  layout.y -= 30
}

function renderTable(layout: PdfDocumentLayout, columns: TableColumn[], rows: TableRow[]) {
  const { contentLeft, contentRight } = PDF_LAYOUT
  const tableWidth = contentRight - contentLeft
  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0)
  const bounds: number[] = [contentLeft]
  let cursor = contentLeft
  for (const column of columns) {
    cursor += (tableWidth * column.weight) / totalWeight
    bounds.push(cursor)
  }
  bounds[bounds.length - 1] = contentRight

  const textWidth = (index: number) => bounds[index + 1]! - bounds[index]! - (2 * CELL_PADDING)
  const textPosition = (index: number) => columns[index]!.align === 'right'
    ? { x: bounds[index + 1]! - CELL_PADDING, align: 'right' as const }
    : { x: bounds[index]! + CELL_PADDING, align: 'left' as const }

  const drawHeader = () => {
    const labelLines = columns.map((column, index) => wrapTextByWidth(column.label, textWidth(index), 9))
    const height = labelLines.reduce((max, lines) => Math.max(max, lines.length * LINE_HEIGHT), LINE_HEIGHT) + 6
    layout.page.rects.push({ x: contentLeft, y: layout.y - height, width: tableWidth, height, fill: true, color: PDF_COLORS.accentTint })
    layout.page.lines.push({ x1: contentLeft, y1: layout.y - height, x2: contentRight, y2: layout.y - height, width: 1, color: PDF_COLORS.accent })
    labelLines.forEach((lines, index) => {
      const { x, align } = textPosition(index)
      lines.forEach((line, lineIndex) => {
        if (line) layout.page.texts.push({ x, y: layout.y - 11 - (lineIndex * LINE_HEIGHT), size: 9, text: line, font: 'F2', align, color: PDF_COLORS.accent })
      })
    })
    layout.y -= height + 5
  }

  layout.ensureSpace(60)
  drawHeader()
  layout.onContinuationPage(drawHeader)

  rows.forEach((row, rowIndex) => {
    const cells = row.cells.map(cell => (typeof cell === 'string' ? { text: cell } : cell))
    const cellLines = cells.map((cell, index) => ({
      main: cell.text ? (columns[index]!.align === 'right' ? [cell.text] : wrapTextByWidth(cell.text, textWidth(index), 9)) : [],
      sub: cell.subLine ? wrapTextByWidth(cell.subLine, textWidth(index), 7.5) : [],
    }))
    const contentHeight = cellLines.reduce((max, lines) => Math.max(
      max,
      (lines.main.length * LINE_HEIGHT) + (lines.sub.length ? 1 + (lines.sub.length * SUB_LINE_HEIGHT) : 0),
    ), LINE_HEIGHT)
    const rowHeight = contentHeight + 7

    layout.ensureSpace(rowHeight)
    const top = layout.y

    if (row.tone) {
      layout.page.rects.push({
        x: contentLeft,
        y: top - rowHeight,
        width: tableWidth,
        height: rowHeight,
        fill: true,
        color: row.tone === 'band' ? PDF_COLORS.accentWash : PDF_COLORS.warningWash,
      })
    }

    cellLines.forEach((lines, index) => {
      const { x, align } = textPosition(index)
      const cell = cells[index]!
      lines.main.forEach((line, lineIndex) => {
        if (line) {
          layout.page.texts.push({
            x,
            y: top - 12 - (lineIndex * LINE_HEIGHT),
            size: 9,
            text: line,
            font: row.bold || cell.bold ? 'F2' : 'F1',
            align,
            color: cell.color,
          })
        }
      })
      const subStart = top - 12 - (lines.main.length * LINE_HEIGHT)
      lines.sub.forEach((line, lineIndex) => {
        if (line) layout.page.texts.push({ x, y: subStart - (lineIndex * SUB_LINE_HEIGHT), size: 7.5, text: line, gray: 0.35, align })
      })
    })

    const isLast = rowIndex === rows.length - 1
    layout.page.lines.push({
      x1: contentLeft,
      y1: top - rowHeight,
      x2: contentRight,
      y2: top - rowHeight,
      width: isLast ? 1 : 0.5,
      gray: isLast ? undefined : 0.82,
      color: isLast ? PDF_COLORS.accent : undefined,
    })

    row.onPlaced?.({ pageIndex: layout.pageIndex, x: contentLeft, y: top - rowHeight, width: tableWidth, height: rowHeight })
    layout.y -= rowHeight
  })

  layout.onContinuationPage(() => {})
}

/** Small gray explanation lines under a table. */
function renderNotes(layout: PdfDocumentLayout, notes: string[]) {
  const { contentLeft, contentRight } = PDF_LAYOUT
  if (!notes.length) return
  layout.y -= 6
  for (const note of notes) {
    for (const line of wrapTextByWidth(note, contentRight - contentLeft, 8)) {
      layout.ensureSpace(11)
      if (line) layout.page.texts.push({ x: contentLeft, y: layout.y - 8, size: 8, text: line, gray: 0.4 })
      layout.y -= 11
    }
  }
}

/** Label/value block as in the finance analysis header. */
function renderMetaRows(layout: PdfDocumentLayout, rows: Array<[string, string]>, labelWidth = 110) {
  const { contentLeft, contentRight } = PDF_LAYOUT
  for (const [label, value] of rows) {
    const lines = wrapTextByWidth(value, contentRight - (contentLeft + labelWidth), 10)
    layout.ensureSpace(lines.length * 13 + 4)
    layout.page.texts.push({ x: contentLeft, y: layout.y, size: 10, text: label, font: 'F2', color: PDF_COLORS.neutral })
    lines.forEach((line, index) => {
      if (line) layout.page.texts.push({ x: contentLeft + labelWidth, y: layout.y - (index * 13), size: 10, text: line })
    })
    layout.y -= 15 + ((lines.length - 1) * 13)
  }
}

// ---------------------------------------------------------------------------
// Overview (table of contents)
// ---------------------------------------------------------------------------

export interface CoverLink {
  /** Page of the overview the row is on (0-based). */
  pageIndex: number
  rect: { x: number, y: number, width: number, height: number }
  /** Index of the linked item. */
  itemIndex: number
}

/**
 * Title page in the finance-analysis style (centered brand, title, meta block) followed by a table of
 * contents: one row per record with the page its document starts on. Returns the PDF plus the row
 * rectangles, which the merge turns into links once the target pages exist.
 */
export function buildDocumentExportCover(params: {
  source: DocumentExportSource
  items: DocumentExportItem[]
  /** 1-based page in the merged document where each item starts. */
  startPages: number[]
  totalPages: number
  context: DocumentExportContext
}) {
  const { source, items, startPages, totalPages, context } = params
  const { scope } = context
  const layout = createPdfDocumentLayout({ logo: context.logo })
  const links: CoverLink[] = []
  const amountColumn = sourceAmountColumn(source, scope)

  const hasLogo = layout.drawCenteredBrand(context.association)
  const titleY = hasLogo ? 722 : 738
  layout.centeredText(source.title, { y: titleY, size: 18, font: 'F2', color: PDF_COLORS.accent })
  layout.centeredText(source.subtitle?.(items) || countLabel(source, items.length), { y: titleY - 20, size: 13, gray: 0.25 })
  layout.page.rects.push({ x: PDF_LAYOUT.headingCenterX - 40, y: titleY - 32, width: 80, height: 2, fill: true, color: PDF_COLORS.accent })
  layout.y = hasLogo ? 672 : 688

  const withoutDocument = items.filter(item => !item.file).length
  const metaRows: Array<[string, string]> = [
    ...(scope.costCentre ? [['Kostenstelle:', scope.costCentre.label] as [string, string]] : []),
    ['Erstellt am:', formatExportDate(context.createdOn)],
    ['Umfang:', compactParts([countLabel(source, items.length), `${totalPages} ${totalPages === 1 ? 'Seite' : 'Seiten'}`], ' · ')],
  ]
  if (amountColumn && source.formatAmount) {
    metaRows.push([scope.costCentre ? 'Summe (Anteil):' : 'Summe:', source.formatAmount(totalAmount(items))])
  }
  if (withoutDocument > 0) metaRows.push(['Ohne Dokument:', `${countLabel(source, withoutDocument)} – dafür ist eine Seite mit den Daten eingefügt.`])
  renderMetaRows(layout, metaRows)
  layout.y -= 14

  renderSectionTitle(layout, 'Inhalt')

  const pdfColumns = sourceColumns(source, scope).filter(column => column.pdfWeight !== undefined)
  const rows: TableRow[] = items.map((item, itemIndex) => ({
    tone: item.file ? undefined : 'warning',
    cells: [
      String(itemIndex + 1),
      ...pdfColumns.map(column => ({
        text: item.values[column.key] ?? '',
        subLine: !item.file && column.key === source.primaryColumn ? missingDocumentText(item) : undefined,
      })),
      { text: String(startPages[itemIndex] ?? ''), bold: true, color: PDF_COLORS.accent },
    ],
    onPlaced: placement => links.push({ pageIndex: placement.pageIndex, rect: placement, itemIndex }),
  }))

  if (amountColumn && source.formatAmount) {
    const total = source.formatAmount(totalAmount(items))
    rows.push({
      bold: true,
      tone: 'band',
      cells: ['', ...pdfColumns.map((column, index) => column.key === amountColumn ? total : index === 0 ? 'Summe' : ''), ''],
    })
  }

  renderTable(layout, [
    { label: 'Nr.', weight: 0.45 },
    ...pdfColumns.map(column => ({ label: column.label, weight: column.pdfWeight!, align: column.align })),
    { label: 'Seite', weight: 0.55, align: 'right' as const },
  ], rows)
  renderNotes(layout, source.overviewNotes?.(scope) ?? [])

  const pdf = layout.finish(exportFooterLabel(source, context), { firstPage: 1, totalPages })
  return { pdf, links, pageCount: layout.pageIndex + 1 }
}

// ---------------------------------------------------------------------------
// Placeholder for records without an embeddable document
// ---------------------------------------------------------------------------

export function buildDocumentExportPlaceholder(params: {
  source: DocumentExportSource
  item: DocumentExportItem
  notice: string
  context: DocumentExportContext
  pageNumbering?: { firstPage: number, totalPages: number }
}) {
  const { source, item, notice, context, pageNumbering } = params
  const layout = createPdfDocumentLayout({ logo: null })
  const { contentLeft, contentRight } = PDF_LAYOUT

  layout.y = PDF_LAYOUT.continuationTop
  layout.page.texts.push({ x: contentLeft, y: layout.y - 16, size: 16, text: item.label, font: 'F2', color: PDF_COLORS.accent })
  layout.page.rects.push({ x: contentLeft, y: layout.y - 28, width: contentRight - contentLeft, height: 2, fill: true, color: PDF_COLORS.accent })
  layout.y -= 46

  const noticeLines = wrapTextByWidth(notice, contentRight - contentLeft - 24, 10)
  const boxHeight = noticeLines.length * 13 + 14
  layout.page.rects.push({ x: contentLeft, y: layout.y - boxHeight, width: contentRight - contentLeft, height: boxHeight, fill: true, color: PDF_COLORS.warningWash })
  layout.page.rects.push({ x: contentLeft, y: layout.y - boxHeight, width: 3, height: boxHeight, fill: true, color: PDF_COLORS.warning })
  noticeLines.forEach((line, index) => {
    layout.page.texts.push({ x: contentLeft + 14, y: layout.y - 17 - (index * 13), size: 10, text: line, font: index === 0 ? 'F2' : 'F1', color: PDF_COLORS.warning })
  })
  layout.y -= boxHeight + 24

  renderMetaRows(layout, item.details.map(detail => [detail.label, detail.value || '-']), 130)

  const detailTable = item.detailTable
  if (detailTable?.rows.length) {
    layout.y -= 16
    renderSectionTitle(layout, detailTable.title)
    const highlighted = new Set(detailTable.highlightedRows ?? [])
    renderTable(layout, detailTable.columns, detailTable.rows.map((cells, index) => (
      highlighted.has(index) ? { cells, bold: true, tone: 'band' as const } : { cells }
    )))
    if (detailTable.note) renderNotes(layout, [detailTable.note])
  }

  return layout.finish(exportFooterLabel(source, context), pageNumbering)
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Every page of the export is A4 portrait, so the merged PDF prints and reads uniformly. */
const A4 = { width: PDF_LAYOUT.pageWidth, height: PDF_LAYOUT.pageHeight }
/** Tolerance for treating a source page as A4 already (A4 is 595.28 × 841.89 pt; generators round differently). */
const A4_TOLERANCE = 2

type QuarterTurn = 0 | 90 | 180 | 270

function normalizeQuarterTurn(angle: number): QuarterTurn {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360
  return normalized as QuarterTurn
}

/**
 * Drawing options that place content of the unrotated size `width` × `height`, turned clockwise by
 * `turn`, with the bottom-left corner of its *displayed* box at (`x`, `y`). pdf-lib rotates
 * counter-clockwise around the anchor point, hence the negated angle and the shifted anchor.
 */
function placeTurned(turn: QuarterTurn, x: number, y: number, width: number, height: number) {
  switch (turn) {
    case 90: return { x, y: y + width, width, height, rotate: degrees(-90) }
    case 180: return { x: x + width, y: y + height, width, height, rotate: degrees(-180) }
    case 270: return { x: x + height, y, width, height, rotate: degrees(-270) }
    default: return { x, y, width, height, rotate: degrees(0) }
  }
}

/**
 * Scale and position for content whose displayed size is `displayWidth` × `displayHeight` on an A4
 * portrait page: centred, shrunk to fit inside `margin` when too large, enlarged only when `enlarge`.
 */
function fitOnA4(displayWidth: number, displayHeight: number, options: { margin: number, enlarge: boolean }) {
  const fitsAsIs = displayWidth <= A4.width + 0.01 && displayHeight <= A4.height + 0.01
  let scale = 1
  if (!fitsAsIs || options.enlarge) {
    scale = Math.min((A4.width - 2 * options.margin) / displayWidth, (A4.height - 2 * options.margin) / displayHeight)
    if (!options.enlarge) scale = Math.min(scale, 1)
  }
  const width = displayWidth * scale
  const height = displayHeight * scale
  return { scale, x: (A4.width - width) / 2, y: (A4.height - height) / 2 }
}

/**
 * EXIF orientation of a JPEG as a clockwise quarter turn (mirrored variants are treated as their
 * rotation). pdf-lib embeds the raw pixels, so a phone photo stored sideways would otherwise appear
 * turned. Images uploaded through the receipt editor are already redrawn upright; this covers the rest.
 */
export function jpegOrientationTurn(data: Buffer): QuarterTurn {
  if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) return 0
  let offset = 2
  while (offset + 4 <= data.length && data[offset] === 0xFF) {
    const marker = data[offset + 1]!
    const length = data.readUInt16BE(offset + 2)
    if (marker === 0xDA || marker === 0xD9) break // image data starts — no EXIF before it
    if (marker === 0xE1 && data.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
      const tiff = offset + 10
      const little = data.toString('latin1', tiff, tiff + 2) === 'II'
      const read16 = (at: number) => (little ? data.readUInt16LE(at) : data.readUInt16BE(at))
      const read32 = (at: number) => (little ? data.readUInt32LE(at) : data.readUInt32BE(at))
      const ifd = tiff + read32(tiff + 4)
      if (ifd + 2 > data.length) return 0
      const entries = read16(ifd)
      for (let index = 0; index < entries; index += 1) {
        const entry = ifd + 2 + (index * 12)
        if (entry + 12 > data.length) return 0
        if (read16(entry) !== 0x0112) continue
        const orientation = read16(entry + 8)
        if (orientation === 3 || orientation === 4) return 180
        if (orientation === 5 || orientation === 6) return 90
        if (orientation === 7 || orientation === 8) return 270
        return 0
      }
      return 0
    }
    offset += 2 + length
  }
  return 0
}

/** An image on its own A4 portrait page, upright and fitted inside a small margin. */
async function imageDocument(file: { mime_type: string, data: Buffer }) {
  const target = await PDFDocument.create()
  const isPng = file.mime_type === 'image/png'
  const image = isPng ? await target.embedPng(file.data) : await target.embedJpg(file.data)
  const turn = isPng ? 0 : jpegOrientationTurn(file.data)
  const sideways = turn === 90 || turn === 270
  const displayWidth = sideways ? image.height : image.width
  const displayHeight = sideways ? image.width : image.height
  const { scale, x, y } = fitOnA4(displayWidth, displayHeight, { margin: IMAGE_MARGIN, enlarge: true })
  target.addPage([A4.width, A4.height]).drawImage(image, placeTurned(turn, x, y, image.width * scale, image.height * scale))
  return target
}

/**
 * Appends every page of `source` to `target` as an A4 portrait page with its content upright: pages
 * that already are upright A4 portrait are copied unchanged (keeping links and form fields); any
 * other size or a `/Rotate` page is embedded and drawn turned as a viewer would show it, centred and
 * shrunk to fit (never enlarged, so small receipts keep their real size).
 */
async function appendNormalizedPages(target: PDFDocument, source: PDFDocument) {
  for (const [index, page] of source.getPages().entries()) {
    const turn = normalizeQuarterTurn(page.getRotation().angle)
    const box = page.getCropBox()
    const isA4Portrait = turn === 0
      && Math.abs(box.width - A4.width) <= A4_TOLERANCE
      && Math.abs(box.height - A4.height) <= A4_TOLERANCE

    if (isA4Portrait) {
      const [copied] = await target.copyPages(source, [index])
      target.addPage(copied!)
      continue
    }

    // A page without a content stream (e.g. a blank scan) cannot be embedded — it is blank anyway.
    if (!page.node.Contents()) {
      target.addPage([A4.width, A4.height])
      continue
    }

    let embedded
    try {
      embedded = await target.embedPage(page, {
        left: box.x,
        bottom: box.y,
        right: box.x + box.width,
        top: box.y + box.height,
      })
    } catch (err) {
      // Never lose content over a layout nicety: keep the page as it is.
      console.error('document export: page could not be normalized, copied unchanged', err)
      const [copied] = await target.copyPages(source, [index])
      target.addPage(copied!)
      continue
    }
    const sideways = turn === 90 || turn === 270
    const { scale, x, y } = fitOnA4(sideways ? box.height : box.width, sideways ? box.width : box.height, { margin: IMAGE_MARGIN, enlarge: false })
    target.addPage([A4.width, A4.height]).drawPage(embedded, placeTurned(turn, x, y, box.width * scale, box.height * scale))
  }
}

type Section =
  | { kind: 'document', document: PDFDocument, pageCount: number }
  | { kind: 'placeholder', notice: string, pageCount: number }

/**
 * Turns each record into the pages it contributes. A document that cannot be read (corrupt,
 * encrypted, unknown type) is replaced by a placeholder naming the reason, never dropped.
 */
async function resolveSections(source: DocumentExportSource, items: DocumentExportItem[], context: DocumentExportContext) {
  const sections: Section[] = []

  for (const item of items) {
    const file = item.file
    let notice: string

    if (!file) {
      notice = item.fileMissing ? 'Die hinterlegte Datei wurde im Speicher nicht gefunden.' : 'Zu diesem Eintrag ist kein Dokument hinterlegt.'
    } else if (file.mime_type === 'application/pdf') {
      try {
        const document = await PDFDocument.load(file.data, { ignoreEncryption: true, updateMetadata: false })
        if (document.isEncrypted) {
          notice = `Das Dokument „${file.original_name}“ ist verschlüsselt und kann nicht eingebunden werden. Die Originaldatei ist über den ZIP-Export erhältlich.`
        } else if (document.getPageCount() > 0) {
          sections.push({ kind: 'document', document, pageCount: document.getPageCount() })
          continue
        } else {
          notice = `Das Dokument „${file.original_name}“ enthält keine Seiten.`
        }
      } catch {
        notice = `Das Dokument „${file.original_name}“ konnte nicht gelesen werden. Die Originaldatei ist über den ZIP-Export erhältlich.`
      }
    } else if (['image/jpeg', 'image/jpg', 'image/png'].includes(file.mime_type)) {
      try {
        sections.push({ kind: 'document', document: await imageDocument(file), pageCount: 1 })
        continue
      } catch {
        notice = `Das Bild „${file.original_name}“ konnte nicht gelesen werden.`
      }
    } else {
      notice = `Das Dokument „${file.original_name}“ hat ein Format, das nicht in ein PDF eingebunden werden kann.`
    }

    // Page count only; the final render (with page numbers) happens once the layout is known.
    const probe = await PDFDocument.load(buildDocumentExportPlaceholder({ source, item, notice, context }))
    sections.push({ kind: 'placeholder', notice, pageCount: probe.getPageCount() })
  }

  return sections
}

/** Adds a clickable area on `page` that jumps to `target` (fitted to the window). */
function addInternalLink(document: PDFDocument, pageIndex: number, rect: CoverLink['rect'], target: PDFRef) {
  const context = document.context
  const annotation = context.register(context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Border: [0, 0, 0],
    Dest: [target, 'Fit'],
  }))
  document.getPage(pageIndex).node.addAnnot(annotation)
}

/** Flat bookmark list (shown in the viewer's sidebar) so the export can be navigated without the overview, too. */
function addOutline(document: PDFDocument, entries: Array<{ title: string, pageIndex: number }>) {
  if (!entries.length) return
  const context = document.context
  const outlineRef = context.nextRef()
  const entryRefs = entries.map(() => context.nextRef())

  entries.forEach((entry, index) => {
    const dict = context.obj({
      Title: PDFHexString.fromText(entry.title),
      Parent: outlineRef,
      Dest: [document.getPage(entry.pageIndex).ref, 'Fit'],
    })
    if (index > 0) dict.set(PDFName.of('Prev'), entryRefs[index - 1]!)
    if (index < entries.length - 1) dict.set(PDFName.of('Next'), entryRefs[index + 1]!)
    context.assign(entryRefs[index]!, dict)
  })

  context.assign(outlineRef, context.obj({
    Type: 'Outlines',
    First: entryRefs[0]!,
    Last: entryRefs[entryRefs.length - 1]!,
    Count: entries.length,
  }))
  document.catalog.set(PDFName.of('Outlines'), outlineRef)
  document.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
}

/** One PDF: optional overview with linked table of contents, then every record's document (or its placeholder) in order. */
export async function buildMergedDocumentExportPdf(params: {
  source: DocumentExportSource
  items: DocumentExportItem[]
  includeCover: boolean
  context: DocumentExportContext
}) {
  const { source, items, includeCover, context } = params
  const sections = await resolveSections(source, items, context)
  const bodyPages = sections.reduce((sum, section) => sum + section.pageCount, 0)

  let cover: { document: PDFDocument, links: CoverLink[] } | null = null
  let coverPages = 0
  if (includeCover) {
    // The overview lists the page each record starts on, which depends on how long the overview itself
    // is; re-render until its page count is stable (it settles after one or two passes).
    coverPages = 1
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const startPages: number[] = []
      let next = coverPages + 1
      for (const section of sections) {
        startPages.push(next)
        next += section.pageCount
      }
      const built = buildDocumentExportCover({ source, items, startPages, totalPages: coverPages + bodyPages, context })
      cover = { document: await PDFDocument.load(built.pdf), links: built.links }
      if (built.pageCount === coverPages) break
      coverPages = built.pageCount
    }
  }

  const totalPages = coverPages + bodyPages
  const merged = await PDFDocument.create()
  merged.setTitle(source.title)
  merged.setCreator('FSi Buchhaltung')

  const appendDocument = async (document: PDFDocument) => {
    const pages = await merged.copyPages(document, document.getPageIndices())
    for (const page of pages) merged.addPage(page)
  }

  if (cover) await appendDocument(cover.document)

  const itemStartIndex: number[] = []
  for (const [index, section] of sections.entries()) {
    itemStartIndex.push(merged.getPageCount())
    if (section.kind === 'document') {
      await appendNormalizedPages(merged, section.document)
    } else {
      const firstPage = merged.getPageCount() + 1
      await appendDocument(await PDFDocument.load(buildDocumentExportPlaceholder({
        source,
        item: items[index]!,
        notice: section.notice,
        context,
        pageNumbering: { firstPage, totalPages },
      })))
    }
  }

  if (cover) {
    for (const link of cover.links) {
      addInternalLink(merged, link.pageIndex, link.rect, merged.getPage(itemStartIndex[link.itemIndex]!).ref)
    }
  }

  addOutline(merged, [
    ...(cover ? [{ title: 'Übersicht', pageIndex: 0 }] : []),
    ...items.map((item, index) => ({ title: `${index + 1}. ${item.label}`, pageIndex: itemStartIndex[index]! })),
  ])

  return Buffer.from(await merged.save())
}
