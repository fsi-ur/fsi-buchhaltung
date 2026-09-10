import {
  buildImageObject,
  buildPdfDocument,
  centeredImageX,
  drawImages,
  drawLines,
  drawRects,
  drawText,
  estimateTextWidth,
  wrapTextByWidth,
  type PdfImage,
  type PdfImageObject,
  type PdfColor,
  type PdfLine,
  type PdfLink,
  type PdfRect,
  type PdfText,
} from '~/server/utils/pdf'
import type { AssociationProfileRow } from '~/types/association'

/** Shared A4 portrait metrics used by every generated document so margins and pagination stay consistent. */
export const PDF_LAYOUT = {
  pageWidth: 595.25,
  pageHeight: 842,
  contentLeft: 55,
  contentRight: 540,
  bottomLimit: 78,
  continuationTop: 800,
  headingCenterX: 595.25 / 2,
} as const

export interface PdfPageBuffer {
  texts: PdfText[]
  lines: PdfLine[]
  rects: PdfRect[]
  images: PdfImage[]
  links: PdfLink[]
}

function compactAddressLine(parts: Array<string | null | undefined>) {
  return parts.map(part => String(part ?? '').trim()).filter(Boolean).join(' ')
}

/**
 * Common skeleton for all generated PDFs: page buffers, pagination with a repeated
 * continuation header, the standard heading variants and the standard footer.
 * Content coordinates stay with the individual generators.
 */
export function createPdfDocumentLayout(params: {
  logo?: { mimeType: string, data: Buffer } | null
}) {
  const imageObject: PdfImageObject | null = params.logo ? buildImageObject(params.logo) : null

  const pageBuffers: PdfPageBuffer[] = []
  let page: PdfPageBuffer = { texts: [], lines: [], rects: [], images: [], links: [] }
  pageBuffers.push(page)
  let y = 0
  let continuationHeader: (() => void) | null = null

  const layout = {
    imageObject,
    get page() {
      return page
    },
    get y() {
      return y
    },
    set y(value: number) {
      y = value
    },
    /** Index of the page currently being written to, so callers can record where a section landed. */
    get pageIndex() {
      return pageBuffers.length - 1
    },

    insertPages(atIndex: number, count: number) {
      const inserted: PdfPageBuffer[] = Array.from({ length: count }, () => ({ texts: [], lines: [], rects: [], images: [], links: [] }))
      pageBuffers.splice(atIndex, 0, ...inserted)
      return inserted
    },

    /** Drawn at the top of every continuation page (usually the repeated table header). */
    onContinuationPage(handler: () => void) {
      continuationHeader = handler
    },

    startContinuationPage() {
      page = { texts: [], lines: [], rects: [], images: [], links: [] }
      pageBuffers.push(page)
      y = PDF_LAYOUT.continuationTop
      continuationHeader?.()
    },

    ensureSpace(requiredHeight: number) {
      if (y - requiredHeight >= PDF_LAYOUT.bottomLimit) return
      layout.startContinuationPage()
    },

    /** Pushes a horizontally centered text line at the given baseline. */
    centeredText(text: string, options: { y: number, size: number, font?: PdfText['font'], gray?: number, color?: PdfColor }) {
      page.texts.push({
        x: PDF_LAYOUT.headingCenterX - (estimateTextWidth(text, options.size, false, options.font) / 2),
        y: options.y,
        size: options.size,
        text,
        font: options.font,
        gray: options.gray,
        color: options.color,
      })
    },

    /** Centered brand block used by statement-style documents: logo at the top, or the association name as a wordmark. Returns whether a logo was drawn. */
    drawCenteredBrand(association: AssociationProfileRow | null) {
      if (imageObject) {
        const logoWidth = 120
        const logoHeight = (logoWidth * imageObject.height) / imageObject.width
        page.images.push({
          x: centeredImageX(PDF_LAYOUT.headingCenterX, logoWidth, imageObject),
          y: 750,
          width: logoWidth,
          height: logoHeight,
          objectName: 'Im1',
        })
        return true
      }

      if (association) {
        layout.centeredText(association.short_name || association.name, { y: 780, size: 22, font: 'F2' })
      }
      return false
    },

    /** Letterhead block used by list/form documents: association address top-left, logo top-right. Returns the y where content may start. */
    drawLetterhead(association: AssociationProfileRow | null) {
      const top = PDF_LAYOUT.continuationTop
      let textY = top - 10

      if (association) {
        for (const line of wrapTextByWidth(association.name, 330, 10.5)) {
          if (!line) continue
          page.texts.push({ x: PDF_LAYOUT.contentLeft, y: textY, size: 10.5, text: line, font: 'F2' })
          textY -= 13
        }

        const addressLines = [
          compactAddressLine([association.street, association.street_number]),
          compactAddressLine([association.postal_code, association.city]),
        ].filter(Boolean)
        for (const line of addressLines) {
          page.texts.push({ x: PDF_LAYOUT.contentLeft, y: textY, size: 9.5, text: line })
          textY -= 12
        }
      }

      let logoBottom = top
      if (imageObject) {
        const logoWidth = 100
        const logoHeight = (logoWidth * imageObject.height) / imageObject.width
        const bounds = imageObject.contentBounds ?? { left: 0, right: 1 }
        page.images.push({
          x: PDF_LAYOUT.contentRight - (bounds.right * logoWidth),
          y: top - logoHeight,
          width: logoWidth,
          height: logoHeight,
          objectName: 'Im1',
        })
        logoBottom = top - logoHeight
      }

      return Math.min(textY, logoBottom) - 10
    },

    /** Draws the standard footer (separator, label, page numbers) on every page and assembles the final document. */
    finish(footerLabel: string) {
      pageBuffers.forEach((buffer, index) => {
        buffer.lines.push({ x1: PDF_LAYOUT.contentLeft, y1: 58, x2: PDF_LAYOUT.contentRight, y2: 58, width: 0.8 })
        buffer.texts.push(
          { x: PDF_LAYOUT.contentLeft, y: 46, size: 8.5, text: footerLabel, gray: 0.35 },
          { x: PDF_LAYOUT.contentRight, y: 46, size: 8.5, text: `Seite ${index + 1} von ${pageBuffers.length}`, align: 'right', gray: 0.35 },
        )
      })

      const pages = pageBuffers.map(buffer => [
        '0 g 0 G',
        ...drawRects(buffer.rects),
        ...drawLines(buffer.lines),
        ...drawImages(buffer.images),
        '0 g 0 G',
        ...drawText(buffer.texts),
      ].join('\n'))

      return buildPdfDocument({ pages, imageObject, links: pageBuffers.map(buffer => buffer.links) })
    },
  }

  return layout
}

export type PdfDocumentLayout = ReturnType<typeof createPdfDocumentLayout>
