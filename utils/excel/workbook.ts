import type { LocalDateTime } from '~/shared/time'
export type SpreadsheetCellType = 'String' | 'Number'
export type WorksheetOrientation = 'portrait' | 'landscape'

export interface SpreadsheetCell {
  value: string | number
  styleId?: string
  mergeAcross?: number
  type?: SpreadsheetCellType
}

export interface SpreadsheetRowDefinition {
  cells: SpreadsheetCell[]
  height?: number
}

export type SpreadsheetImageExtension = 'png' | 'jpg' | 'jpeg'

export interface SpreadsheetImageAnchor {
  fromColumn: number
  fromRow: number
  toColumn?: number
  toRow?: number
  fromColumnOffset?: number
  fromRowOffset?: number
  toColumnOffset?: number
  toRowOffset?: number
  widthEmu?: number
  heightEmu?: number
}

export interface SpreadsheetImageDefinition {
  data: Uint8Array
  extension: SpreadsheetImageExtension
  mimeType: string
  fileName?: string
  altText?: string
  anchor: SpreadsheetImageAnchor
}

export interface SpreadsheetWorksheetDefinition {
  name: string
  columnWidths: number[]
  rows: SpreadsheetRowDefinition[]
  orientation?: WorksheetOrientation
  fitToWidth?: number
  fitToHeight?: number
  marginLeft?: number
  marginRight?: number
  marginTop?: number
  marginBottom?: number
  images?: SpreadsheetImageDefinition[]
}

export interface SpreadsheetWorkbookDefinition {
  sheets: SpreadsheetWorksheetDefinition[]
  modifiedAt: LocalDateTime
  stylesXml?: string
  author?: string
  company?: string
}

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const TEXT_ENCODER = new TextEncoder()

const STYLE_INDEX = {
  Default: 0,
  Title: 1,
  Subtitle: 2,
  Section: 3,
  Label: 4,
  Body: 5,
  BodyMuted: 6,
  Header: 7,
  TextCell: 8,
  CurrencyCell: 9,
  CountCell: 10,
  PositiveCurrencyCell: 11,
  NegativeCurrencyCell: 12,
  PositiveCountCell: 13,
  NegativeCountCell: 14,
  GroupTextCell: 15,
  GroupCurrencyCell: 16,
  GroupPositiveCurrencyCell: 17,
  GroupNegativeCurrencyCell: 18,
} as const

const CRC_TABLE = createCrcTable()

function createCrcTable() {
  const table = new Uint32Array(256)

  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }

  return table
}

function crc32(bytes: Uint8Array) {
  let value = 0xFFFFFFFF

  for (const byte of bytes) {
    const tableValue = CRC_TABLE[(value ^ byte) & 0xFF] ?? 0
    value = tableValue ^ (value >>> 8)
  }

  return (value ^ 0xFFFFFFFF) >>> 0
}

function xmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('\n', '&#10;')
}

function sanitizeSheetName(value: string) {
  const sanitized = value.replace(/[\\/?*\[\]:]/g, ' ').trim()
  return sanitized.slice(0, 31) || 'Sheet1'
}

function columnName(columnNumber: number) {
  let result = ''
  let current = columnNumber

  while (current > 0) {
    const remainder = (current - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    current = Math.floor((current - 1) / 26)
  }

  return result || 'A'
}

function cellReference(rowNumber: number, columnNumber: number) {
  return `${columnName(columnNumber)}${rowNumber}`
}

function encodeXml(content: string) {
  return TEXT_ENCODER.encode(content)
}

function preserveWhitespace(value: string) {
  return /^\s|\s$|\n/.test(value)
}

function excelColumnWidth(width: number) {
  return Number(Math.max(width / 7, 6).toFixed(2))
}

function getStyleIndex(styleId?: string) {
  if (!styleId) return STYLE_INDEX.Body
  return STYLE_INDEX[styleId as keyof typeof STYLE_INDEX] ?? STYLE_INDEX.Body
}

function createWorksheetXml(sheet: Omit<SpreadsheetWorksheetDefinition, 'images'> & { images?: unknown[] }) {
  const orientation = sheet.orientation === 'portrait' ? 'portrait' : 'landscape'
  const fitToWidth = Math.max(sheet.fitToWidth ?? 1, 1)
  const fitToHeight = Math.max(sheet.fitToHeight ?? 0, 0)
  const marginLeft = sheet.marginLeft ?? 0.2
  const marginRight = sheet.marginRight ?? 0.2
  const marginTop = sheet.marginTop ?? 0.28
  const marginBottom = sheet.marginBottom ?? 0.28
  const merges: string[] = []
  const rowXml: string[] = []
  let maxColumn = Math.max(sheet.columnWidths.length, 1)

  sheet.rows.forEach((row, rowIndex) => {
    let currentColumn = 1
    const cellXml: string[] = []

    row.cells.forEach((cell) => {
      const reference = cellReference(rowIndex + 1, currentColumn)
      const styleIndex = getStyleIndex(cell.styleId)

      if (cell.type === 'Number' && typeof cell.value === 'number' && Number.isFinite(cell.value)) {
        cellXml.push(`<c r="${reference}" s="${styleIndex}"><v>${cell.value}</v></c>`)
      } else {
        const textValue = String(cell.value ?? '')
        const preserve = preserveWhitespace(textValue) ? ' xml:space="preserve"' : ''
        cellXml.push(`<c r="${reference}" s="${styleIndex}" t="inlineStr"><is><t${preserve}>${xmlEscape(textValue)}</t></is></c>`)
      }

      const mergeAcross = cell.mergeAcross ?? 0
      if (mergeAcross > 0) {
        merges.push(`<mergeCell ref="${reference}:${cellReference(rowIndex + 1, currentColumn + mergeAcross)}"/>`)
        for (let offset = 1; offset <= mergeAcross; offset += 1) {
          const mergedReference = cellReference(rowIndex + 1, currentColumn + offset)
          cellXml.push(`<c r="${mergedReference}" s="${styleIndex}" t="inlineStr"><is><t></t></is></c>`)
        }
      }

      currentColumn += mergeAcross + 1
    })

    maxColumn = Math.max(maxColumn, currentColumn - 1)

    const heightAttributes = row.height ? ` ht="${row.height}" customHeight="1"` : ''
    rowXml.push(`<row r="${rowIndex + 1}"${heightAttributes}>${cellXml.join('')}</row>`)
  })

  const dimensionEnd = cellReference(Math.max(sheet.rows.length, 1), maxColumn)
  const columnsXml = sheet.columnWidths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${excelColumnWidth(width)}" customWidth="1"/>`)
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr>
    <pageSetUpPr fitToPage="1" autoPageBreaks="0"/>
  </sheetPr>
  <dimension ref="A1:${dimensionEnd}"/>
  <sheetViews>
    <sheetView workbookViewId="0"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${columnsXml}</cols>
  <sheetData>${rowXml.join('')}</sheetData>
  ${merges.length > 0 ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}
  <printOptions horizontalCentered="1"/>
  <pageMargins left="${marginLeft}" right="${marginRight}" top="${marginTop}" bottom="${marginBottom}" header="0.2" footer="0.2"/>
  <pageSetup orientation="${orientation}" paperSize="9" fitToWidth="${fitToWidth}" fitToHeight="${fitToHeight}"/>
  ${sheet.images?.length ? '<drawing r:id="rId1"/>' : ''}
</worksheet>`
}

function createWorkbookXml(sheetNames: string[]) {
  const sheetsXml = sheetNames
    .map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews>
    <workbookView activeTab="0"/>
  </bookViews>
  <sheets>${sheetsXml}</sheets>
</workbook>`
}

function createWorkbookRelationshipsXml(sheetCount: number) {
  const sheetRelationships = Array.from({ length: sheetCount }, (_, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRelationships}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
}

function createRootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
}

function createWorksheetRelationshipsXml(drawingIndex: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/>
</Relationships>`
}

function createDrawingRelationshipsXml(images: PreparedSheetImage[]) {
  const imageRelationships = images.map((image, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${xmlEscape(image.targetFileName)}"/>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${imageRelationships}
</Relationships>`
}

function createContentTypesXml(sheetCount: number, drawingCount: number, imageExtensions: SpreadsheetImageExtension[]) {
  const worksheetOverrides = Array.from({ length: sheetCount }, (_, index) => {
    return `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  }).join('')
  const drawingOverrides = Array.from({ length: drawingCount }, (_, index) => {
    return `<Override PartName="/xl/drawings/drawing${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
  }).join('')
  const imageDefaults = Array.from(new Set(imageExtensions))
    .map((extension) => {
      const contentType = extension === 'png' ? 'image/png' : 'image/jpeg'
      return `<Default Extension="${extension}" ContentType="${contentType}"/>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${imageDefaults}
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${worksheetOverrides}
  ${drawingOverrides}
</Types>`
}

function createAppPropertiesXml(sheetNames: string[], company: string) {
  const titles = sheetNames.map(name => `<vt:lpstr>${xmlEscape(name)}</vt:lpstr>`).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>FSi Accounting</Application>
  <Company>${xmlEscape(company)}</Company>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector>
  </TitlesOfParts>
</Properties>`
}

function createCorePropertiesXml(author: string) {
  const timestamp = new Date().toISOString()

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>${xmlEscape(author)}</dc:creator>
  <cp:lastModifiedBy>${xmlEscape(author)}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`
}

function createStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="4">
    <numFmt numFmtId="164" formatCode="#,##0.00 [$&#x20AC;-407]"/>
    <numFmt numFmtId="165" formatCode="0"/>
    <numFmt numFmtId="166" formatCode="+#,##0.00 [$&#x20AC;-407];-#,##0.00 [$&#x20AC;-407];0.00 [$&#x20AC;-407]"/>
    <numFmt numFmtId="167" formatCode="+0;-0;0"/>
  </numFmts>
  <fonts count="9">
    <font><sz val="10"/><color rgb="FF171717"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FF171717"/><name val="Aptos Display"/><family val="2"/></font>
    <font><i/><sz val="10"/><color rgb="FF746A6A"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF171717"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF171717"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font>
    <font><sz val="10"/><color rgb="FF746A6A"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FF3E9B72"/><name val="Aptos"/><family val="2"/></font>
    <font><b/><sz val="10"/><color rgb="FFC26268"/><name val="Aptos"/><family val="2"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8F5F5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE9D4D6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFCC3B43"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="4">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD5C4C5"/></left>
      <right style="thin"><color rgb="FFD5C4C5"/></right>
      <top style="thin"><color rgb="FFD5C4C5"/></top>
      <bottom style="thin"><color rgb="FFD5C4C5"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FFC89DA0"/></left>
      <right style="thin"><color rgb="FFC89DA0"/></right>
      <top style="medium"><color rgb="FFC89DA0"/></top>
      <bottom style="medium"><color rgb="FFC89DA0"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FFCC3B43"/></left>
      <right style="thin"><color rgb="FFCC3B43"/></right>
      <top style="thin"><color rgb="FFCC3B43"/></top>
      <bottom style="medium"><color rgb="FFB13A42"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="19">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="7" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="8" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="167" fontId="7" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="167" fontId="8" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="4" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="7" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="8" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`
}

interface PreparedSheetImage {
  targetFileName: string
  image: SpreadsheetImageDefinition
}

type PreparedWorksheetDefinition = Omit<SpreadsheetWorksheetDefinition, 'images'> & {
  images?: PreparedSheetImage[]
}

function createDrawingXml(images: PreparedSheetImage[]) {
  const anchors = images.map((entry, index) => {
    const {
      fromColumn,
      fromRow,
      toColumn,
      toRow,
      fromColumnOffset = 0,
      fromRowOffset = 0,
      toColumnOffset = 0,
      toRowOffset = 0,
      widthEmu,
      heightEmu,
    } = entry.image.anchor
    const pictureName = entry.image.fileName ?? `Image ${index + 1}`
    const altText = entry.image.altText ?? pictureName
    const pictureXml = `<xdr:pic>
    <xdr:nvPicPr>
      <xdr:cNvPr id="${index + 1}" name="${xmlEscape(pictureName)}" descr="${xmlEscape(altText)}"/>
      <xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>
    </xdr:nvPicPr>
    <xdr:blipFill>
      <a:blip r:embed="rId${index + 1}"/>
      <a:stretch><a:fillRect/></a:stretch>
    </xdr:blipFill>
    <xdr:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    </xdr:spPr>
  </xdr:pic>`

    if (typeof widthEmu === 'number' && typeof heightEmu === 'number') {
      return `<xdr:oneCellAnchor>
  <xdr:from>
    <xdr:col>${fromColumn}</xdr:col>
    <xdr:colOff>${fromColumnOffset}</xdr:colOff>
    <xdr:row>${fromRow}</xdr:row>
    <xdr:rowOff>${fromRowOffset}</xdr:rowOff>
  </xdr:from>
  <xdr:ext cx="${widthEmu}" cy="${heightEmu}"/>
  ${pictureXml}
  <xdr:clientData/>
</xdr:oneCellAnchor>`
    }

    return `<xdr:twoCellAnchor editAs="oneCell">
  <xdr:from>
    <xdr:col>${fromColumn}</xdr:col>
    <xdr:colOff>${fromColumnOffset}</xdr:colOff>
    <xdr:row>${fromRow}</xdr:row>
    <xdr:rowOff>${fromRowOffset}</xdr:rowOff>
  </xdr:from>
  <xdr:to>
    <xdr:col>${toColumn}</xdr:col>
    <xdr:colOff>${toColumnOffset}</xdr:colOff>
    <xdr:row>${toRow}</xdr:row>
    <xdr:rowOff>${toRowOffset}</xdr:rowOff>
  </xdr:to>
  ${pictureXml}
  <xdr:clientData/>
</xdr:twoCellAnchor>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${anchors}
</xdr:wsDr>`
}

function getDosDateTime(value: LocalDateTime) {
  const [rawYear, month, day, hour, minute, second] = value.split(/[- :]/).map(Number) as [number, number, number, number, number, number]
  const year = Math.max(rawYear, 1980)
  const dosDate = ((year - 1980) << 9) | (month << 5) | day
  const dosTime = (hour << 11) | (minute << 5) | Math.floor(second / 2)

  return { dosDate, dosTime }
}

function createZip(entries: { name: string, data: Uint8Array }[], modifiedAt: LocalDateTime) {
  const localFiles: Uint8Array[] = []
  const centralDirectory: Uint8Array[] = []
  const { dosDate, dosTime } = getDosDateTime(modifiedAt)
  let offset = 0

  for (const entry of entries) {
    const fileName = TEXT_ENCODER.encode(entry.name)
    const crc = crc32(entry.data)

    const localHeader = new Uint8Array(30 + fileName.length + entry.data.length)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034B50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, dosTime, true)
    localView.setUint16(12, dosDate, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, entry.data.length, true)
    localView.setUint32(22, entry.data.length, true)
    localView.setUint16(26, fileName.length, true)
    localView.setUint16(28, 0, true)
    localHeader.set(fileName, 30)
    localHeader.set(entry.data, 30 + fileName.length)
    localFiles.push(localHeader)

    const centralHeader = new Uint8Array(46 + fileName.length)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014B50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, dosTime, true)
    centralView.setUint16(14, dosDate, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, entry.data.length, true)
    centralView.setUint32(24, entry.data.length, true)
    centralView.setUint16(28, fileName.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    centralHeader.set(fileName, 46)
    centralDirectory.push(centralHeader)

    offset += localHeader.length
  }

  const centralDirectoryOffset = offset
  const centralDirectorySize = centralDirectory.reduce((total, part) => total + part.length, 0)
  const endRecord = new Uint8Array(22)
  const endView = new DataView(endRecord.buffer)
  endView.setUint32(0, 0x06054B50, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralDirectorySize, true)
  endView.setUint32(16, centralDirectoryOffset, true)
  endView.setUint16(20, 0, true)

  const archiveSize = localFiles.reduce((total, part) => total + part.length, 0) + centralDirectorySize + endRecord.length
  const archive = new Uint8Array(archiveSize)
  let cursor = 0

  for (const part of [...localFiles, ...centralDirectory, endRecord]) {
    archive.set(part, cursor)
    cursor += part.length
  }

  return archive
}

export function sanitizeFileNamePart(value: string) {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function createSpreadsheetCell(cell: SpreadsheetCell) {
  return {
    styleId: 'Body',
    mergeAcross: 0,
    type: 'String' as SpreadsheetCellType,
    ...cell,
  }
}

export function createSpreadsheetRow(cells: SpreadsheetCell[], height?: number): SpreadsheetRowDefinition {
  return {
    cells: cells.map(createSpreadsheetCell),
    height,
  }
}

export function createSpreadsheetWorkbook({ sheets, modifiedAt, stylesXml, author = 'FSi Accounting', company = 'FSi Accounting' }: SpreadsheetWorkbookDefinition) {
  const imageExtensions: SpreadsheetImageExtension[] = []
  let globalImageIndex = 0
  const preparedSheets: PreparedWorksheetDefinition[] = sheets.map(sheet => ({
    ...sheet,
    name: sanitizeSheetName(sheet.name),
    images: sheet.images?.map((image) => {
      globalImageIndex += 1
      imageExtensions.push(image.extension)
      const extension = image.extension === 'jpg' ? 'jpg' : image.extension
      return {
        targetFileName: `image${globalImageIndex}.${extension}`,
        image,
      }
    }),
  }))
  const sheetsWithImages = preparedSheets.filter(sheet => sheet.images?.length)
  const workbookStylesXml = stylesXml ?? createStylesXml()

  const entries = [
    { name: '[Content_Types].xml', data: encodeXml(createContentTypesXml(preparedSheets.length, sheetsWithImages.length, imageExtensions)) },
    { name: '_rels/.rels', data: encodeXml(createRootRelationshipsXml()) },
    { name: 'docProps/app.xml', data: encodeXml(createAppPropertiesXml(preparedSheets.map(sheet => sheet.name), company)) },
    { name: 'docProps/core.xml', data: encodeXml(createCorePropertiesXml(author)) },
    { name: 'xl/workbook.xml', data: encodeXml(createWorkbookXml(preparedSheets.map(sheet => sheet.name))) },
    { name: 'xl/_rels/workbook.xml.rels', data: encodeXml(createWorkbookRelationshipsXml(preparedSheets.length)) },
    { name: 'xl/styles.xml', data: encodeXml(workbookStylesXml) },
    ...preparedSheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: encodeXml(createWorksheetXml(sheet)),
    })),
    ...(() => {
      let drawingIndex = 0

      return preparedSheets.flatMap((sheet, index) => {
      if (!sheet.images?.length) return []

      drawingIndex += 1
      return [{
        name: `xl/worksheets/_rels/sheet${index + 1}.xml.rels`,
        data: encodeXml(createWorksheetRelationshipsXml(drawingIndex)),
      }, {
        name: `xl/drawings/drawing${drawingIndex}.xml`,
        data: encodeXml(createDrawingXml(sheet.images)),
      }, {
        name: `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`,
        data: encodeXml(createDrawingRelationshipsXml(sheet.images)),
      }, ...sheet.images.map(image => ({
        name: `xl/media/${image.targetFileName}`,
        data: image.image.data,
      }))]
      })
    })(),
  ]

  return new Blob([createZip(entries, modifiedAt)], { type: XLSX_MIME_TYPE })
}

export function downloadExcelWorkbook(content: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(content)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
