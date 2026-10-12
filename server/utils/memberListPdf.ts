import { wrapTextByWidth } from '~/server/utils/pdf'
import { createPdfDocumentLayout, PDF_LAYOUT } from '~/server/utils/pdfLayout'
import {
  memberExportCellValue,
  memberExportColumnMetrics,
  type MemberExportRow,
} from '~/server/utils/memberExport'
import type { AssociationProfileRow } from '~/types/association'
import type { MemberExportConfig } from '~/types/member'
import type { LocalDate } from '~/shared/time'

const CELL_PADDING = 4
const LINE_HEIGHT = 11

export function buildMemberListPdf(params: {
  config: MemberExportConfig
  members: MemberExportRow[]
  association: AssociationProfileRow | null
  logo?: { mimeType: string, data: Buffer } | null
  /** "Stand" — today in the app time zone. */
  createdOn: LocalDate
}) {
  const { config, members, association, logo = null, createdOn } = params
  const layout = createPdfDocumentLayout({ logo })

  const { contentLeft, contentRight } = PDF_LAYOUT
  const tableWidth = contentRight - contentLeft

  // Column boundaries from per-kind weights, so e.g. signature columns get more room than date columns.
  const weights = config.columns.map(column => memberExportColumnMetrics(column).weight)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const bounds: number[] = [contentLeft]
  let cursor = contentLeft
  for (const weight of weights) {
    cursor += (tableWidth * weight) / totalWeight
    bounds.push(cursor)
  }
  bounds[bounds.length - 1] = contentRight

  const columnWidth = (index: number) => bounds[index + 1]! - bounds[index]! - (2 * CELL_PADDING)
  const columnTextX = (index: number) => bounds[index]! + CELL_PADDING

  // Blank columns are meant to be filled in by hand, so give the rows writing space.
  const hasBlankColumns = config.columns.some(column => column.key === 'blank')
  const minRowHeight = hasBlankColumns ? 26 : 0

  const drawVerticals = (topY: number, bottomY: number) => {
    for (const x of bounds) {
      layout.page.lines.push({ x1: x, y1: topY, x2: x, y2: bottomY, width: 0.5, gray: 0.5 })
    }
  }

  const drawTableHeader = () => {
    const labelLines = config.columns.map((column, index) => wrapTextByWidth(column.label, columnWidth(index), 9.5))
    const hintLines = config.columns.map((column, index) => column.hint
      ? wrapTextByWidth(column.hint, columnWidth(index), 7.5)
      : [])

    const headerHeight = config.columns.reduce((height, _, index) => {
      const cellHeight = (labelLines[index]!.length * LINE_HEIGHT)
        + (hintLines[index]!.length ? 1 + (hintLines[index]!.length * 9) : 0)
      return Math.max(height, cellHeight)
    }, 0) + 9

    const top = layout.y
    layout.page.lines.push(
      { x1: contentLeft, y1: top, x2: contentRight, y2: top, width: 0.8 },
      { x1: contentLeft, y1: top - headerHeight, x2: contentRight, y2: top - headerHeight, width: 0.8 },
    )

    config.columns.forEach((_, index) => {
      const firstBaseline = top - 12
      labelLines[index]!.forEach((line, lineIndex) => {
        if (!line) return
        layout.page.texts.push({
          x: columnTextX(index),
          y: firstBaseline - (lineIndex * LINE_HEIGHT),
          size: 9.5,
          text: line,
          font: 'F2',
        })
      })

      const hintStart = firstBaseline - (labelLines[index]!.length * LINE_HEIGHT) + 1
      hintLines[index]!.forEach((line, lineIndex) => {
        if (!line) return
        layout.page.texts.push({
          x: columnTextX(index),
          y: hintStart - (lineIndex * 9),
          size: 7.5,
          text: line,
          gray: 0.35,
        })
      })
    })

    drawVerticals(top, top - headerHeight)
    layout.y -= headerHeight
  }
  layout.onContinuationPage(drawTableHeader)

  const renderMember = (member: MemberExportRow, isLast: boolean) => {
    const cellLines = config.columns.map((column, index) => {
      const value = memberExportCellValue(member, column)
      return value ? wrapTextByWidth(value, columnWidth(index), 9) : []
    })

    const contentHeight = cellLines.reduce((height, lines) => Math.max(height, lines.length * LINE_HEIGHT), LINE_HEIGHT)
    const rowHeight = Math.max(contentHeight + 7, minRowHeight)

    layout.ensureSpace(rowHeight)

    const top = layout.y
    const firstBaseline = top - 12

    cellLines.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        if (!line) return
        layout.page.texts.push({
          x: columnTextX(index),
          y: firstBaseline - (lineIndex * LINE_HEIGHT),
          size: 9,
          text: line,
        })
      })
    })

    layout.page.lines.push({
      x1: contentLeft,
      y1: top - rowHeight,
      x2: contentRight,
      y2: top - rowHeight,
      width: isLast ? 0.8 : 0.5,
      gray: isLast ? 0 : 0.5,
    })
    drawVerticals(top, top - rowHeight)

    layout.y -= rowHeight
  }

  layout.y = layout.drawLetterhead(association) - 24

  for (const line of wrapTextByWidth(config.title, tableWidth, 13)) {
    if (!line) continue
    layout.page.texts.push({ x: contentLeft, y: layout.y, size: 13, text: line, font: 'F2' })
    layout.y -= 17
  }

  const createdAt = `${createdOn.slice(8, 10)}.${createdOn.slice(5, 7)}.${createdOn.slice(0, 4)}`
  layout.page.texts.push({
    x: contentLeft,
    y: layout.y - 2,
    size: 9,
    text: `${members.length} ${members.length === 1 ? 'Mitglied' : 'Mitglieder'} · Stand: ${createdAt}`,
    gray: 0.35,
  })
  layout.y -= 18

  drawTableHeader()

  members.forEach((member, index) => renderMember(member, index === members.length - 1))

  if (!members.length) {
    layout.page.texts.push({
      x: contentLeft + CELL_PADDING,
      y: layout.y - 14,
      size: 10,
      text: 'Keine Mitglieder vorhanden.',
      gray: 0.35,
    })
  }

  const footerLabel = [association?.short_name || association?.name, config.title]
    .filter(Boolean)
    .join(' · ')

  return layout.finish(footerLabel)
}
