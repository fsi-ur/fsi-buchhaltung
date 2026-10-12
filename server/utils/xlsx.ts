import { deflateRawSync, deflateSync } from 'zlib'
import { readImageSize, wrapText } from '~/server/utils/pdf'
import type { LocalDateTime } from '~/shared/time'

/**
 * Minimal XLSX writer, hand-rolled like the PDF writer in `server/utils/pdf.ts`
 * so exports need no extra dependency. Produces a single-sheet workbook with a
 * consistent, print-ready design: title block, styled header row, bordered
 * cells, frozen header, auto filter and a page setup (fit to width, repeated
 * title rows, page-number footer) so "Export to PDF" from Excel matches the
 * app's generated PDFs.
 */

export interface XlsxColumn {
  label: string
  /** Small gray second line inside the header cell, e.g. "(wenn anwesend)". */
  hint?: string
  /** Column width in Excel character units. */
  width?: number
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer) {
  let crc = 0xFFFFFFFF
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]!) & 0xFF]! ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/** ZIP entry times are zone-less DOS wall clocks; fill them from a wall clock in the app time zone. */
function dosDateTime(value: LocalDateTime) {
  const [year, month, day, hour, minute, second] = value.split(/[- :]/).map(Number) as [number, number, number, number, number, number]
  const time = (hour << 11) | (minute << 5) | Math.floor(second / 2)
  const date = ((Math.max(year, 1980) - 1980) << 9) | (month << 5) | day
  return { time, day: date }
}

/** Builds a stored/deflated ZIP archive (the container format of .xlsx). */
function buildZip(entries: Array<{ name: string, data: Buffer }>, modifiedAt: LocalDateTime) {
  const { time, day } = dosDateTime(modifiedAt)
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const checksum = crc32(entry.data)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034B50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(8, 8)
    localHeader.writeUInt16LE(time, 10)
    localHeader.writeUInt16LE(day, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(entry.data.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localHeader.writeUInt16LE(0, 28)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014B50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(8, 10)
    centralHeader.writeUInt16LE(time, 12)
    centralHeader.writeUInt16LE(day, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(entry.data.length, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt32LE(offset, 42)

    localParts.push(localHeader, nameBytes, compressed)
    centralParts.push(centralHeader, nameBytes)
    offset += localHeader.length + nameBytes.length + compressed.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, ...centralParts, end])
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;')
}

function columnLetter(index: number) {
  let result = ''
  let value = index
  while (value >= 0) {
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26) - 1
  }
  return result
}

function inlineString(value: string, style: number, cellRef: string) {
  if (!value) return `<c r="${cellRef}" s="${style}"/>`
  return `<c r="${cellRef}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

function headerCell(column: XlsxColumn, cellRef: string) {
  const label = `<r><rPr><b/><sz val="11"/><rFont val="Calibri"/></rPr><t xml:space="preserve">${escapeXml(column.label)}</t></r>`
  const hint = column.hint
    ? `<r><rPr><sz val="8"/><color rgb="FF64748B"/><rFont val="Calibri"/></rPr><t xml:space="preserve">\n${escapeXml(column.hint)}</t></r>`
    : ''
  return `<c r="${cellRef}" s="3" t="inlineStr"><is>${label}${hint}</is></c>`
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>
</fonts>
<fills count="2">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border>
<left style="thin"><color rgb="FF475569"/></left>
<right style="thin"><color rgb="FF475569"/></right>
<top style="thin"><color rgb="FF475569"/></top>
<bottom style="thin"><color rgb="FF475569"/></bottom>
<diagonal/>
</border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

const EMU_PER_PIXEL = 9525

/** A4 page width in points per orientation, matching `pageSetup paperSize="9"`. */
const A4_WIDTH_PT = { portrait: 595.3, landscape: 841.9 } as const
const PAGE_MARGIN_LR_PT = 0.6 * 72

function pngChunk(type: string, data: Buffer) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0)
  return Buffer.concat([header, data, crc])
}

/**
 * 1px-wide PNG whose top row is black and the rest transparent. Stretched wide
 * in the footer, the black row prints as the separator rule of the generated
 * PDFs while the transparent rows push it above the footer text (footer
 * pictures are anchored at the text, not above it).
 */
const FOOTER_RULE_PNG_HEIGHT = 20

function buildFooterRulePng() {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(FOOTER_RULE_PNG_HEIGHT, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(FOOTER_RULE_PNG_HEIGHT * 5)
  raw[4] = 255
  const idat = deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Footer pictures need a legacy VML part; the `CF` shape id anchors the image
 * at the `&G` placeholder in the centre footer section. The markup mirrors
 * what Excel itself writes — including the `o:lock` elements, without which
 * Excel crashes on open.
 */
function buildFooterRuleVml(widthPt: number, heightPt: number) {
  return `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>
<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f">
<v:stroke joinstyle="miter"/>
<v:formulas>
<v:f eqn="if lineDrawn pixelLineWidth 0"/>
<v:f eqn="sum @0 1 0"/>
<v:f eqn="sum 0 0 @1"/>
<v:f eqn="prod @2 1 2"/>
<v:f eqn="prod @3 21600 pixelWidth"/>
<v:f eqn="prod @3 21600 pixelHeight"/>
<v:f eqn="sum @0 0 1"/>
<v:f eqn="prod @6 1 2"/>
<v:f eqn="prod @7 21600 pixelWidth"/>
<v:f eqn="sum @8 21600 0"/>
<v:f eqn="prod @7 21600 pixelHeight"/>
<v:f eqn="sum @10 21600 0"/>
</v:formulas>
<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>
<o:lock v:ext="edit" aspectratio="t"/>
</v:shapetype>
<v:shape id="CF" o:spid="_x0000_s1025" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:${widthPt}pt;height:${heightPt}pt;z-index:1">
<v:imagedata o:relid="rId1" o:title="rule"/>
<o:lock v:ext="edit" rotation="t"/>
</v:shape>
</xml>`
}

/** Approximate pixel width of a column given its width in Excel character units (Calibri 11 convention). */
function columnPixelWidth(width: number) {
  return Math.round(width * 7) + 5
}

/**
 * Builds the SpreadsheetDrawing part that anchors the logo at the top-right of
 * the table, mirroring the letterhead of the generated PDFs.
 */
function buildLogoDrawing(params: {
  logo: { mimeType: string, data: Buffer }
  columnWidths: number[]
}) {
  const size = readImageSize(params.logo)
  if (!size) return null

  const pixelWidths = params.columnWidths.map(columnPixelWidth)
  const tableRight = pixelWidths.reduce((sum, width) => sum + width, 0)

  // Cap by table width too, so the logo leaves room for the letterhead text on narrow tables.
  let displayWidth = Math.min(130, Math.round(tableRight * 0.35))
  let displayHeight = (displayWidth * size.height) / size.width
  const maxHeight = 76
  if (displayHeight > maxHeight) {
    displayWidth = (maxHeight * size.width) / size.height
    displayHeight = maxHeight
  }

  // Right-align the logo with the table edge by translating the pixel offset into a cell anchor.
  const startX = Math.max(tableRight - displayWidth, 0)

  let anchorColumn = 0
  let columnOffset = startX
  for (const width of pixelWidths) {
    if (columnOffset < width) break
    columnOffset -= width
    anchorColumn += 1
  }

  const extension = params.logo.mimeType.toLowerCase() === 'image/png' ? 'png' : 'jpeg'
  const drawingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<xdr:oneCellAnchor>
<xdr:from><xdr:col>${anchorColumn}</xdr:col><xdr:colOff>${Math.round(columnOffset * EMU_PER_PIXEL)}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${4 * EMU_PER_PIXEL}</xdr:rowOff></xdr:from>
<xdr:ext cx="${Math.round(displayWidth * EMU_PER_PIXEL)}" cy="${Math.round(displayHeight * EMU_PER_PIXEL)}"/>
<xdr:pic>
<xdr:nvPicPr><xdr:cNvPr id="1" name="Logo"/><xdr:cNvPicPr/></xdr:nvPicPr>
<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(displayWidth * EMU_PER_PIXEL)}" cy="${Math.round(displayHeight * EMU_PER_PIXEL)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
</xdr:pic>
<xdr:clientData/>
</xdr:oneCellAnchor>
</xdr:wsDr>`

  return { drawingXml, extension, data: params.logo.data }
}

export function buildXlsxWorkbook(params: {
  sheetName: string
  title: string
  subtitle?: string
  columns: XlsxColumn[]
  rows: string[][]
  orientation?: 'portrait' | 'landscape'
  /** Left side of the printed footer, e.g. the association name. */
  footerLabel?: string
  /** Gray placeholder text below the header when there are no data rows, matching the generated PDFs. */
  emptyText?: string
  /** Minimum row height in points for data rows, e.g. for signature space. */
  dataRowHeight?: number
  /** Association letterhead block above the title, matching the generated PDFs. */
  letterhead?: { name: string, addressLines: string[] } | null
  /** Logo anchored at the top-right of the table, matching the generated PDFs. */
  logo?: { mimeType: string, data: Buffer } | null
  /** File timestamp inside the archive — the current wall clock in the app time zone. */
  modifiedAt: LocalDateTime
}) {
  const {
    modifiedAt,
    sheetName,
    title,
    subtitle = '',
    columns,
    rows,
    orientation = 'portrait',
    footerLabel = '',
    emptyText = '',
    dataRowHeight = 0,
    letterhead = null,
    logo = null,
  } = params

  const safeSheetName = (sheetName.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Export').slice(0, 31)

  const sheetRows: string[] = []
  let rowCursor = 1
  const textRow = (value: string, style: number) => {
    sheetRows.push(`<row r="${rowCursor}"><c r="A${rowCursor}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c></row>`)
    rowCursor += 1
  }

  if (letterhead) {
    // Wrap the association name into extra rows so it never runs underneath the top-right logo
    // (a single overflowing cell would). ~7.5px per bold Calibri 11 character, logo needs ~150px.
    const tableWidthPx = columns.reduce((sum, column) => sum + columnPixelWidth(column.width ?? 18), 0)
    const reservedPx = logo ? 150 : 12
    const maxNameChars = Math.max(Math.floor((tableWidthPx - reservedPx) / 7.5), 24)
    for (const line of wrapText(letterhead.name, maxNameChars)) {
      if (line.trim()) textRow(line, 5)
    }
    for (const line of letterhead.addressLines) {
      if (line.trim()) textRow(line, 0)
    }
    rowCursor += 1
  }

  textRow(title, 1)
  if (subtitle) textRow(subtitle, 2)
  rowCursor += 1

  const headerRowIndex = rowCursor
  const dataStartIndex = headerRowIndex + 1
  const lastRowIndex = headerRowIndex + Math.max(rows.length, 1)
  const lastColLetter = columnLetter(columns.length - 1)

  const hasHints = columns.some(column => Boolean(column.hint))
  const headerCells = columns.map((column, index) => headerCell(column, `${columnLetter(index)}${headerRowIndex}`)).join('')
  sheetRows.push(`<row r="${headerRowIndex}" ht="${hasHints ? 30 : 20}" customHeight="1">${headerCells}</row>`)

  const rowHeightAttr = dataRowHeight > 0 ? ` ht="${dataRowHeight}" customHeight="1"` : ''
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!
    const rowRef = dataStartIndex + rowIndex
    const cells = columns.map((_, colIndex) => inlineString(String(row[colIndex] ?? ''), 4, `${columnLetter(colIndex)}${rowRef}`)).join('')
    sheetRows.push(`<row r="${rowRef}"${rowHeightAttr}>${cells}</row>`)
  }

  if (!rows.length && emptyText) {
    sheetRows.push(`<row r="${dataStartIndex}"><c r="A${dataStartIndex}" s="2" t="inlineStr"><is><t xml:space="preserve">${escapeXml(emptyText)}</t></is></c></row>`)
  }

  const cols = columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 18}" customWidth="1"/>`)
    .join('')

  const drawing = logo ? buildLogoDrawing({ logo, columnWidths: columns.map(column => column.width ?? 18) }) : null

  const footerRuleWidthPt = A4_WIDTH_PT[orientation] - (2 * PAGE_MARGIN_LR_PT)
  const footerRuleVml = buildFooterRuleVml(footerRuleWidthPt, 14)

  const footerLeft = footerLabel ? `&amp;L&amp;9${escapeXml(footerLabel)}` : ''
  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${lastColLetter}${lastRowIndex}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRowIndex}" topLeftCell="A${dataStartIndex}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${sheetRows.join('')}</sheetData>
<autoFilter ref="A${headerRowIndex}:${lastColLetter}${lastRowIndex}"/>
<pageMargins left="0.6" right="0.6" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="${orientation}" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>${footerLeft}&amp;C&amp;G&amp;R&amp;9Seite &amp;P von &amp;N</oddFooter></headerFooter>
${drawing ? '<drawing r:id="rId1"/>' : ''}<legacyDrawingHF r:id="rId2"/></worksheet>`

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${escapeXml(safeSheetName)}'!$1:$${headerRowIndex}</definedName></definedNames>
</workbook>`

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>
<Default Extension="png" ContentType="image/png"/>
${drawing && drawing.extension !== 'png' ? `<Default Extension="${drawing.extension}" ContentType="image/${drawing.extension}"/>\n` : ''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${drawing ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>\n' : ''}</Types>`

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRelsXml, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRelsXml, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES_XML, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(worksheetXml, 'utf8') },
  ]

  const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${drawing ? '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>\n' : ''}<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>
</Relationships>`
  const vmlRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/>
</Relationships>`
  entries.push(
    { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: Buffer.from(sheetRelsXml, 'utf8') },
    { name: 'xl/drawings/vmlDrawing1.vml', data: Buffer.from(footerRuleVml, 'utf8') },
    { name: 'xl/drawings/_rels/vmlDrawing1.vml.rels', data: Buffer.from(vmlRelsXml, 'utf8') },
    { name: 'xl/media/image2.png', data: buildFooterRulePng() },
  )

  if (drawing) {
    const drawingRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.${drawing.extension}"/>
</Relationships>`
    entries.push(
      { name: 'xl/drawings/drawing1.xml', data: Buffer.from(drawing.drawingXml, 'utf8') },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', data: Buffer.from(drawingRelsXml, 'utf8') },
      { name: `xl/media/image1.${drawing.extension}`, data: Buffer.from(drawing.data) },
    )
  }

  return buildZip(entries, modifiedAt)
}
