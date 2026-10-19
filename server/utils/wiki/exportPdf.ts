import { estimateTextWidth, wrapTextByWidth, type PdfColor, type PdfFontName, type PdfNamedImage } from '~/server/utils/pdf'
import { createPdfDocumentLayout, PDF_LAYOUT, type PdfDocumentLayout } from '~/server/utils/pdfLayout'
import { parseArticleTokens } from '~/server/utils/wiki/render'
import { WIKI_EMBEDS_BY_KEY } from '~/config/wikiEmbeds'
import type { AssociationProfileRow } from '~/types/association'
import type { WikiChecklistInput } from '~/types/wiki'

export interface WikiPdfArticle {
  id: number
  title: string
  summary: string
  markdown: string
  checklists: WikiChecklistInput[]
  /** Nesting depth in the space tree; drives the table of contents indent. */
  depth: number
  reviewedAt: string | null
  publishedAt: string | null
}

/** File contents of the `bild:<id>` images, keyed by file id; images without an entry print as a placeholder. */
export type WikiPdfImages = Map<number, { mimeType: string, data: Buffer }>

const { contentLeft, contentRight } = PDF_LAYOUT

const BODY_SIZE = 10
const LIST_INDENT = 16
const BLOCK_PADDING = 9
/** Screen pixels → points (96 dpi), so a screenshot prints about as large as it looked; capped to the column. */
const IMAGE_PX_TO_PT = 0.75
const MAX_IMAGE_HEIGHT = 420

/** Roughly the app's Tailwind palette, so a printed article reads like the screen version. */
const COLOR = {
  heading: [0.06, 0.09, 0.16] as PdfColor,
  body: [0.12, 0.16, 0.23] as PdfColor,
  muted: [0.39, 0.45, 0.55] as PdfColor,
  faint: [0.58, 0.64, 0.72] as PdfColor,
  link: [0.15, 0.39, 0.92] as PdfColor,
  glossary: [0.76, 0.25, 0.05] as PdfColor,
  rule: [0.80, 0.84, 0.88] as PdfColor,
  codeText: [0.19, 0.25, 0.33] as PdfColor,
  codeBg: [0.95, 0.96, 0.97] as PdfColor,
  quoteBg: [0.97, 0.98, 0.99] as PdfColor,
  tableHeaderBg: [0.94, 0.96, 0.98] as PdfColor,
  tableBorder: [0.80, 0.84, 0.88] as PdfColor,
  checkbox: [0.58, 0.64, 0.72] as PdfColor,
  white: [1, 1, 1] as PdfColor,
}

interface CalloutStyle {
  label: string
  accent: PdfColor
  background: PdfColor
  labelColor: PdfColor
}

const CALLOUTS: Record<string, CalloutStyle> = {
  hinweis: { label: 'Hinweis', accent: [0.15, 0.39, 0.92], background: [0.94, 0.96, 1], labelColor: [0.11, 0.31, 0.75] },
  warnung: { label: 'Warnung', accent: [0.86, 0.15, 0.15], background: [1, 0.95, 0.95], labelColor: [0.72, 0.11, 0.11] },
  tipp: { label: 'Tipp', accent: [0.09, 0.64, 0.29], background: [0.94, 0.99, 0.95], labelColor: [0.08, 0.50, 0.24] },
}

const HEADING_STYLES: Record<number, { size: number, spaceBefore: number, spaceAfter: number, rule?: boolean }> = {
  1: { size: 15, spaceBefore: 16, spaceAfter: 8, rule: true },
  2: { size: 13, spaceBefore: 14, spaceAfter: 7, rule: true },
  3: { size: 11.5, spaceBefore: 12, spaceAfter: 6 },
  4: { size: 10.5, spaceBefore: 10, spaceAfter: 5 },
}

function formatDate(value: string | null) {
  if (!value) return ''
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value)
}

interface BlockContext {
  /** Left edge of the current block — grows with list nesting. */
  left: number
}

interface RunStyle {
  bold?: boolean
  italic?: boolean
  mono?: boolean
  strike?: boolean
  underline?: boolean
  color?: PdfColor
  size?: number
}

interface TextRun {
  text: string
  style: RunStyle
}

const BREAK_RUN: TextRun = { text: '\n', style: {} }

function runFont(style: RunStyle): PdfFontName {
  if (style.mono) return 'F4'
  if (style.bold && style.italic) return 'F5'
  if (style.bold) return 'F2'
  if (style.italic) return 'F3'
  return 'F1'
}

function runWidth(run: TextRun, size: number) {
  return estimateTextWidth(run.text, run.style.size ?? size, false, runFont(run.style))
}

function runsWidth(runs: TextRun[], size: number) {
  return runs.reduce((total, run) => total + (run.text === '\n' ? 0 : runWidth(run, size)), 0)
}

function plainRuns(text: string, style: RunStyle = {}): TextRun[] {
  return text ? [{ text, style }] : []
}

function runsText(runs: TextRun[]) {
  return runs.map(run => (run.text === '\n' ? ' ' : run.text)).join('')
}

function linkSuffix(href: string, label: string) {
  const target = String(href ?? '').trim()
  if (!target || target.startsWith('#')) return ''
  if (!/^(https?:|mailto:)/i.test(target)) return ''
  const visible = target.replace(/^mailto:/i, '')
  return label.trim() === visible ? '' : ` (${visible})`
}

function inlineRuns(token: any, base: RunStyle = {}): TextRun[] {
  const runs: TextRun[] = []
  const stack: RunStyle[] = [{ ...base }]
  const top = () => stack[stack.length - 1]!
  const openStyle = (patch: RunStyle) => stack.push({ ...top(), ...patch })
  const closeStyle = () => { if (stack.length > 1) stack.pop() }

  let linkHref = ''
  let linkStart = -1

  for (const child of token?.children ?? []) {
    switch (child.type) {
      case 'text':
        if (child.content) runs.push({ text: child.content, style: top() })
        break
      case 'code_inline':
        runs.push({ text: child.content, style: { ...top(), mono: true, color: COLOR.codeText } })
        break
      case 'softbreak':
        runs.push({ text: ' ', style: top() })
        break
      case 'hardbreak':
        runs.push(BREAK_RUN)
        break
      case 'strong_open':
        openStyle({ bold: true })
        break
      case 'em_open':
        openStyle({ italic: true })
        break
      case 's_open':
        openStyle({ strike: true })
        break
      case 'strong_close':
      case 'em_close':
      case 's_close':
        closeStyle()
        break
      case 'link_open':
        linkHref = child.attrGet?.('href') ?? ''
        linkStart = runs.length
        openStyle({ color: COLOR.link, underline: true })
        break
      case 'link_close': {
        closeStyle()
        const suffix = linkSuffix(linkHref, runsText(runs.slice(Math.max(linkStart, 0))))
        if (suffix) runs.push({ text: suffix, style: { ...top(), color: COLOR.muted, size: 8.5 } })
        linkHref = ''
        linkStart = -1
        break
      }
      case 'image':
        runs.push({
          text: `[Bild: ${child.content || child.attrGet?.('alt') || 'ohne Beschriftung'}]`,
          style: { ...top(), italic: true, color: COLOR.muted },
        })
        break
      case 'wiki_article_link': {
        const { spaceSlug, slug, label } = child.meta ?? {}
        runs.push({ text: label || `${spaceSlug}/${slug}`, style: { ...top(), color: COLOR.link, underline: true } })
        runs.push({ text: ` (Wiki: ${spaceSlug}/${slug})`, style: { ...top(), color: COLOR.muted, size: 8.5 } })
        break
      }
      case 'wiki_glossary_ref': {
        const { term, label, display } = child.meta ?? {}
        runs.push({ text: label || display || term, style: { ...top(), color: COLOR.glossary } })
        break
      }
      default:
        break
    }
  }

  return runs
}

interface WrapWord {
  text: string
  style: RunStyle
  spaceBefore: boolean
  lineBreak?: boolean
}

function toWrapWords(runs: TextRun[]): WrapWord[] {
  const words: WrapWord[] = []
  let pendingSpace = false

  for (const run of runs) {
    if (run.text === '\n') {
      words.push({ text: '', style: run.style, spaceBefore: false, lineBreak: true })
      pendingSpace = false
      continue
    }

    const parts = run.text.split(/\s+/).filter(Boolean)
    if (!parts.length) {
      if (/\s/.test(run.text)) pendingSpace = true
      continue
    }

    const leadingSpace = /^\s/.test(run.text)
    parts.forEach((part, index) => {
      words.push({ text: part, style: run.style, spaceBefore: index === 0 ? (pendingSpace || leadingSpace) : true })
    })
    pendingSpace = /\s$/.test(run.text)
  }

  return words
}

function wrapRuns(runs: TextRun[], maxWidth: number, size: number): TextRun[][] {
  const lines: TextRun[][] = []
  let line: TextRun[] = []
  let width = 0

  const flush = () => {
    lines.push(line)
    line = []
    width = 0
  }

  for (const word of toWrapWords(runs)) {
    if (word.lineBreak) {
      flush()
      continue
    }

    const font = runFont(word.style)
    const fontSize = word.style.size ?? size
    let text = line.length && word.spaceBefore ? ` ${word.text}` : word.text
    let candidate = estimateTextWidth(text, fontSize, false, font)

    if (line.length && width + candidate > maxWidth) {
      flush()
      text = word.text
      candidate = estimateTextWidth(text, fontSize, false, font)
    }

    if (candidate > maxWidth) {
      // A single token wider than the column (a long URL, say) is broken on its own.
      wrapTextByWidth(word.text, maxWidth, fontSize).forEach((chunk, index) => {
        if (index > 0) flush()
        line.push({ text: chunk, style: word.style })
        width += estimateTextWidth(chunk, fontSize, false, font)
      })
      continue
    }

    line.push({ text, style: word.style })
    width += candidate
  }

  if (line.length) flush()
  return lines.length ? lines : [[]]
}

function sameStyle(a: RunStyle, b: RunStyle) {
  return runFont(a) === runFont(b)
    && (a.size ?? 0) === (b.size ?? 0)
    && !!a.strike === !!b.strike
    && !!a.underline === !!b.underline
    && String(a.color ?? '') === String(b.color ?? '')
}

function mergeRuns(line: TextRun[]) {
  const merged: TextRun[] = []
  for (const run of line) {
    const previous = merged[merged.length - 1]
    if (previous && sameStyle(previous.style, run.style)) previous.text += run.text
    else merged.push({ text: run.text, style: run.style })
  }
  return merged
}

function drawRunLine(layout: PdfDocumentLayout, line: TextRun[], x: number, baseline: number, size: number) {
  let cursor = x

  for (const run of mergeRuns(line)) {
    const fontSize = run.style.size ?? size
    const width = runWidth(run, size)

    if (run.style.mono) {
      // Backgrounds go to the front of the rect list so a surrounding callout tint cannot cover them.
      layout.page.rects.unshift({
        x: cursor - 1,
        y: baseline - (fontSize * 0.26),
        width: width + 2,
        height: fontSize * 1.18,
        fill: true,
        color: COLOR.codeBg,
      })
    }

    layout.page.texts.push({
      x: cursor,
      y: baseline,
      size: fontSize,
      text: run.text,
      font: runFont(run.style),
      color: run.style.color ?? COLOR.body,
    })

    if (run.style.strike || run.style.underline) {
      const leadingSpaceWidth = run.text.startsWith(' ')
        ? estimateTextWidth(' ', fontSize, false, runFont(run.style))
        : 0
      const offset = run.style.strike ? fontSize * 0.28 : -(fontSize * 0.16)
      layout.page.lines.push({
        x1: cursor + leadingSpaceWidth,
        y1: baseline + offset,
        x2: cursor + width,
        y2: baseline + offset,
        width: 0.5,
        color: run.style.color ?? COLOR.body,
      })
    }

    cursor += width
  }
}

function block(layout: PdfDocumentLayout, runs: TextRun[], context: BlockContext, options: {
  size?: number
  right?: number
  hangingLabel?: string
  hangingColor?: PdfColor
  hangingFont?: PdfFontName
} = {}) {
  const size = options.size ?? BODY_SIZE
  const lineHeight = size * 1.35
  const right = options.right ?? contentRight

  const labelWidth = options.hangingLabel
    ? estimateTextWidth(options.hangingLabel, size, false, options.hangingFont) + 5
    : 0
  const textLeft = context.left + labelWidth
  const lines = wrapRuns(runs, right - textLeft, size)

  if (lines.length === 1 && !lines[0]!.length && !options.hangingLabel) return

  lines.forEach((line, index) => {
    layout.ensureSpace(lineHeight)
    const baseline = layout.y - lineHeight + 3

    if (index === 0 && options.hangingLabel) {
      layout.page.texts.push({
        x: context.left,
        y: baseline,
        size,
        text: options.hangingLabel,
        font: options.hangingFont,
        color: options.hangingColor ?? COLOR.muted,
      })
    }

    drawRunLine(layout, line, textLeft, baseline, size)
    layout.y -= lineHeight
  })
}

type BlockOptions = NonNullable<Parameters<typeof block>[3]>

function bodyImage(layout: PdfDocumentLayout, image: PdfNamedImage, left: number) {
  const maxWidth = contentRight - left
  let width = Math.min(image.object.width * IMAGE_PX_TO_PT, maxWidth)
  let height = (width * image.object.height) / image.object.width
  if (height > MAX_IMAGE_HEIGHT) {
    height = MAX_IMAGE_HEIGHT
    width = (height * image.object.width) / image.object.height
  }

  layout.y -= 4
  layout.ensureSpace(height + 4)
  layout.page.images.push({ x: left, y: layout.y - height, width, height, objectName: image.name })
  layout.y -= height + 8
}

/**
 * An inline token whose `bild:<id>` images are drawn as pictures between the text around them. The first
 * text segment carries `hanging` (a list marker); everything after it lines up with that segment's text.
 */
function inlineWithImages(
  layout: PdfDocumentLayout,
  inline: any,
  context: BlockContext,
  images: WikiPdfImages,
  hanging: BlockOptions = {},
) {
  const children: any[] = inline?.children ?? []
  const embedded = children.map((child) => {
    const fileId = child.type === 'image' ? Number(child.meta?.wikiImageId) : 0
    const source = fileId ? images.get(fileId) : undefined
    return source ? layout.addImage(`wiki-image:${fileId}`, source) : null
  })

  if (!embedded.some(Boolean)) {
    block(layout, inline ? inlineRuns(inline) : [], context, hanging)
    return
  }

  const labelWidth = hanging.hangingLabel
    ? estimateTextWidth(hanging.hangingLabel, BODY_SIZE, false, hanging.hangingFont) + 5
    : 0
  const innerContext: BlockContext = { left: context.left + labelWidth }

  let pending: any[] = []
  let first = true
  const flush = () => {
    if (pending.length || (first && hanging.hangingLabel)) {
      block(layout, inlineRuns({ children: pending }), first ? context : innerContext, first ? hanging : {})
    }
    pending = []
    first = false
  }

  children.forEach((child, position) => {
    const image = embedded[position]
    if (!image) {
      pending.push(child)
      return
    }
    flush()
    bodyImage(layout, image, innerContext.left)
  })
  if (pending.length) flush()
}

function paragraph(layout: PdfDocumentLayout, text: string, context: BlockContext, style: RunStyle = {}) {
  block(layout, plainRuns(text, style), context, { size: style.size })
}

function heading(layout: PdfDocumentLayout, level: number, runs: TextRun[]) {
  const style = HEADING_STYLES[Math.min(Math.max(level, 1), 4)] ?? HEADING_STYLES[4]!
  layout.y -= style.spaceBefore
  layout.ensureSpace(style.size * 2)

  block(
    layout,
    runs.map(run => ({ text: run.text, style: { ...run.style, bold: true, color: run.style.color ?? COLOR.heading } })),
    { left: contentLeft },
    { size: style.size },
  )

  if (style.rule) {
    layout.y -= 3
    layout.page.lines.push({ x1: contentLeft, y1: layout.y, x2: contentRight, y2: layout.y, width: 0.6, color: COLOR.rule })
  }

  layout.y -= style.spaceAfter
}

function accentBlock(layout: PdfDocumentLayout, params: {
  context: BlockContext
  label?: string
  labelColor?: PdfColor
  paragraphs: TextRun[][]
  size: number
  accent: PdfColor
  background?: PdfColor
  baseStyle?: RunStyle
}) {
  const { context, paragraphs, size, accent } = params
  const barX = context.left
  const textLeft = context.left + 12

  let segmentTop = layout.y
  let currentPage = layout.page

  const closeSegment = () => {
    const height = segmentTop - layout.y
    if (height <= 0) return
    if (params.background) {
      currentPage.rects.unshift({
        x: barX,
        y: layout.y - 4,
        width: contentRight - barX,
        height: height + 8,
        fill: true,
        color: params.background,
      })
    }
    currentPage.rects.push({ x: barX, y: layout.y - 4, width: 2.5, height: height + 8, fill: true, color: accent })
  }

  const pushLine = (line: TextRun[], lineSize: number) => {
    const before = layout.page
    layout.ensureSpace(lineSize * 1.35)
    if (layout.page !== before) {
      closeSegment()
      currentPage = layout.page
      segmentTop = layout.y
    }
    drawRunLine(layout, line, textLeft, layout.y - (lineSize * 1.35) + 3, lineSize)
    layout.y -= lineSize * 1.35
  }

  layout.y -= 8
  segmentTop = layout.y
  currentPage = layout.page

  if (params.label) {
    pushLine([{ text: params.label, style: { bold: true, color: params.labelColor ?? accent } }], size)
    layout.y -= 2
  }

  const maxWidth = contentRight - textLeft - BLOCK_PADDING
  paragraphs.forEach((runs, index) => {
    if (index > 0) layout.y -= 4
    const styled = runs.map(run => ({ text: run.text, style: { ...params.baseStyle, ...run.style } }))
    for (const line of wrapRuns(styled, maxWidth, size)) pushLine(line, size)
  })

  closeSegment()
  layout.y -= 12
}

function appOnlyNote(layout: PdfDocumentLayout, label: string, context: BlockContext) {
  const lines = wrapTextByWidth(label, contentRight - context.left - (2 * BLOCK_PADDING), 9)
  const height = (lines.length * 12) + 12
  layout.ensureSpace(height + 8)

  const top = layout.y - 4
  layout.page.rects.push({
    x: context.left,
    y: top - height,
    width: contentRight - context.left,
    height,
    fill: true,
    stroke: true,
    color: COLOR.codeBg,
    borderColor: COLOR.tableBorder,
  })

  lines.forEach((line, index) => {
    layout.page.texts.push({
      x: context.left + BLOCK_PADDING,
      y: top - 16 - (index * 12),
      size: 9,
      text: line,
      font: 'F3',
      color: COLOR.muted,
    })
  })

  layout.y = top - height - 8
}

function checkboxList(layout: PdfDocumentLayout, checklist: WikiChecklistInput, context: BlockContext) {
  layout.y -= 8
  layout.ensureSpace(24)
  paragraph(layout, checklist.title, context, { bold: true, color: COLOR.heading, size: 10.5 })
  layout.y -= 3

  const itemLine = BODY_SIZE * 1.35

  for (const item of checklist.items) {
    const textLeft = context.left + 18
    const lines = wrapTextByWidth(item.label, contentRight - textLeft, BODY_SIZE)
    const hintLines = item.hint ? wrapTextByWidth(item.hint, contentRight - textLeft, 8.5) : []
    const height = (lines.length * itemLine) + (hintLines.length * 11) + 4

    layout.ensureSpace(height)
    const top = layout.y

    layout.page.rects.push({
      x: context.left,
      y: top - 12,
      width: 9.5,
      height: 9.5,
      fill: true,
      stroke: true,
      color: COLOR.white,
      borderColor: COLOR.checkbox,
    })

    lines.forEach((line, index) => {
      layout.page.texts.push({ x: textLeft, y: top - 11 - (index * itemLine), size: BODY_SIZE, text: line, color: COLOR.body })
    })
    hintLines.forEach((line, index) => {
      layout.page.texts.push({
        x: textLeft,
        y: top - 11 - (lines.length * itemLine) - (index * 11),
        size: 8.5,
        text: line,
        color: COLOR.muted,
      })
    })

    layout.y = top - height
  }

  layout.y -= 6
}

function renderTable(layout: PdfDocumentLayout, rows: Array<{ header: boolean, cells: TextRun[][] }>, context: BlockContext) {
  if (!rows.length) return

  const columnCount = rows.reduce((max, row) => Math.max(max, row.cells.length), 0)
  if (!columnCount) return

  const tableLeft = context.left
  const tableWidth = contentRight - tableLeft

  const demand = Array.from({ length: columnCount }, (_, column) => rows.reduce(
    (max, row) => Math.max(max, runsWidth(row.cells[column] ?? [], 9)),
    20,
  ))
  const totalDemand = demand.reduce((sum, value) => sum + value, 0)
  const widths = demand.map(value => Math.max(40, (tableWidth * value) / totalDemand))
  const widthSum = widths.reduce((sum, value) => sum + value, 0)
  const scaled = widths.map(value => (value * tableWidth) / widthSum)

  const bounds = [tableLeft]
  scaled.forEach((width, index) => { bounds.push(bounds[index]! + width) })
  bounds[bounds.length - 1] = contentRight

  layout.y -= 8

  for (const row of rows) {
    const cellLines = Array.from({ length: columnCount }, (_, column) => wrapRuns(
      (row.cells[column] ?? []).map(run => ({
        text: run.text,
        style: {
          ...run.style,
          bold: run.style.bold || row.header,
          color: run.style.color ?? (row.header ? COLOR.heading : COLOR.body),
        },
      })),
      bounds[column + 1]! - bounds[column]! - 8,
      9,
    ))
    const height = (cellLines.reduce((max, lines) => Math.max(max, lines.length), 1) * 12) + 7

    layout.ensureSpace(height)
    const top = layout.y

    if (row.header) {
      layout.page.rects.unshift({ x: tableLeft, y: top - height, width: tableWidth, height, fill: true, color: COLOR.tableHeaderBg })
    }

    cellLines.forEach((lines, column) => {
      lines.forEach((line, index) => {
        if (!line.length) return
        drawRunLine(layout, line, bounds[column]! + 4, top - 12 - (index * 12), 9)
      })
    })

    layout.page.lines.push({
      x1: tableLeft,
      y1: top - height,
      x2: contentRight,
      y2: top - height,
      width: row.header ? 0.8 : 0.4,
      color: row.header ? COLOR.muted : COLOR.tableBorder,
    })

    layout.y = top - height
  }

  layout.y -= 10
}

function directiveLabel(token: any) {
  const { name, embed, tool } = token.meta ?? {}

  if (name === 'embed' && embed) {
    const definition = WIKI_EMBEDS_BY_KEY[embed.key]
    return `Baustein: ${definition ? definition.key : embed.key} - nur in der App verfügbar.`
  }
  if (name === 'tool' && tool) {
    return `Aktion: ${tool.label || tool.page} - nur in der App verfügbar.`
  }
  return ''
}

/** Collects the contents of a container (callout, blockquote) as one run list per paragraph. */
function collectParagraphs(tokens: any[], from: number, closeType: string) {
  const openType = closeType.replace(/_close$/, '_open')
  const paragraphs: TextRun[][] = []
  let cursor = from
  let depth = 1

  while (cursor < tokens.length) {
    const inner = tokens[cursor]
    if (inner.type === closeType) {
      depth -= 1
      if (depth === 0) break
    } else if (inner.type === openType) {
      depth += 1
    } else if (inner.type === 'inline') {
      paragraphs.push(inlineRuns(inner))
    } else if (inner.type === 'fence' || inner.type === 'code_block') {
      paragraphs.push(plainRuns(String(inner.content ?? '').trim(), { mono: true, color: COLOR.codeText }))
    }
    cursor += 1
  }

  return { paragraphs, cursor }
}

function renderMarkdown(layout: PdfDocumentLayout, article: WikiPdfArticle, images: WikiPdfImages) {
  let tokens: any[]
  try {
    tokens = parseArticleTokens(article.markdown, {
      knownChecklists: article.checklists.map(entry => entry.keySlug),
    })
  } catch {
    tokens = []
  }

  const checklistBySlug = new Map(article.checklists.map(entry => [entry.keySlug, entry]))
  const listStack: Array<{ ordered: boolean, counter: number }> = []
  const context: BlockContext = { left: contentLeft }

  const applyIndent = () => { context.left = contentLeft + (listStack.length * LIST_INDENT) }

  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]

    if (token.type === 'heading_open') {
      const inline = tokens[index + 1]
      heading(layout, Number(token.tag.slice(1)) || 2, inline ? inlineRuns(inline) : [])
      index += 3
      continue
    }

    if (token.type === 'paragraph_open') {
      inlineWithImages(layout, tokens[index + 1], context, images)
      layout.y -= 5
      index += 3
      continue
    }

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const start = Number(token.attrGet?.('start') ?? 1)
      listStack.push({ ordered: token.type === 'ordered_list_open', counter: (Number.isFinite(start) ? start : 1) - 1 })
      applyIndent()
      index += 1
      continue
    }

    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listStack.pop()
      applyIndent()
      layout.y -= 4
      index += 1
      continue
    }

    if (token.type === 'list_item_open') {
      const list = listStack[listStack.length - 1]
      if (list) list.counter += 1
      // The item's first paragraph carries the marker, so it is rendered here and then skipped.
      const inlineIndex = tokens[index + 1]?.type === 'paragraph_open' ? index + 2 : -1
      inlineWithImages(layout, inlineIndex >= 0 ? tokens[inlineIndex] : null, context, images, {
        hangingLabel: list?.ordered ? `${list.counter}.` : '•',
        hangingColor: COLOR.faint,
        hangingFont: list?.ordered ? 'F2' : 'F1',
      })
      index = inlineIndex >= 0 ? inlineIndex + 2 : index + 1
      continue
    }

    if (token.type === 'blockquote_open') {
      const { paragraphs, cursor } = collectParagraphs(tokens, index + 1, 'blockquote_close')
      accentBlock(layout, {
        context,
        paragraphs,
        size: BODY_SIZE,
        accent: COLOR.faint,
        background: COLOR.quoteBg,
        baseStyle: { italic: true, color: COLOR.muted },
      })
      index = cursor + 1
      continue
    }

    if (token.type === 'fence' || token.type === 'code_block') {
      const paragraphs = String(token.content ?? '')
        .replace(/\s+$/, '')
        .split('\n')
        .map(line => plainRuns(line || ' ', { mono: true, color: COLOR.codeText }))
      accentBlock(layout, { context, paragraphs, size: 8.5, accent: COLOR.faint, background: COLOR.codeBg })
      index += 1
      continue
    }

    if (token.type === 'hr') {
      layout.ensureSpace(16)
      layout.y -= 7
      layout.page.lines.push({ x1: contentLeft, y1: layout.y, x2: contentRight, y2: layout.y, width: 0.6, color: COLOR.rule })
      layout.y -= 9
      index += 1
      continue
    }

    if (token.type === 'table_open') {
      const rows: Array<{ header: boolean, cells: TextRun[][] }> = []
      let cursor = index + 1
      let header = false
      let cells: TextRun[][] | null = null

      while (cursor < tokens.length && tokens[cursor].type !== 'table_close') {
        const inner = tokens[cursor]
        if (inner.type === 'thead_open') header = true
        else if (inner.type === 'thead_close') header = false
        else if (inner.type === 'tr_open') cells = []
        else if (inner.type === 'tr_close') {
          if (cells) rows.push({ header, cells })
          cells = null
        } else if (inner.type === 'inline' && cells) cells.push(inlineRuns(inner))
        cursor += 1
      }

      renderTable(layout, rows, context)
      index = cursor + 1
      continue
    }

    if (token.type === 'wiki_directive') {
      const { name, checklist } = token.meta ?? {}
      if (name === 'checklist' && checklist && checklistBySlug.has(checklist)) {
        checkboxList(layout, checklistBySlug.get(checklist)!, context)
      } else if (name === 'checklist' && checklist) {
        appOnlyNote(layout, `Checkliste: ${checklist} - nur in der App verfügbar.`, context)
      } else {
        const label = directiveLabel(token)
        if (label) appOnlyNote(layout, label, context)
      }
      index += 1
      continue
    }

    if (typeof token.type === 'string' && token.type.startsWith('container_') && token.type.endsWith('_open')) {
      const name = token.type.slice('container_'.length, -'_open'.length)
      const { paragraphs, cursor } = collectParagraphs(tokens, index + 1, `container_${name}_close`)
      const callout = CALLOUTS[name]
      accentBlock(layout, {
        context,
        label: callout?.label ?? name,
        labelColor: callout?.labelColor,
        paragraphs,
        size: BODY_SIZE,
        accent: callout?.accent ?? COLOR.faint,
        background: callout?.background ?? COLOR.quoteBg,
      })
      index = cursor + 1
      continue
    }

    index += 1
  }
}

function footerLabel(association: AssociationProfileRow | null, subject: string) {
  return [association?.short_name || association?.name, subject].filter(Boolean).join(' · ')
}

function drawArticleMeta(layout: PdfDocumentLayout, article: WikiPdfArticle) {
  const meta = [
    article.publishedAt ? `Aktualisiert am ${formatDate(article.publishedAt)}` : '',
    article.reviewedAt ? `Geprüft am ${formatDate(article.reviewedAt)}` : '',
  ].filter(Boolean).join(' · ')

  if (!meta) return
  paragraph(layout, meta, { left: contentLeft }, { color: COLOR.muted, size: 8.5 })
  layout.y -= 4
}

export function buildWikiArticlePdf(params: {
  article: WikiPdfArticle
  spaceTitle: string
  association: AssociationProfileRow | null
  logo?: { mimeType: string, data: Buffer } | null
  images?: WikiPdfImages
}) {
  const { article, spaceTitle, association, logo = null, images = new Map() } = params
  const layout = createPdfDocumentLayout({ logo })

  const hasLogo = layout.drawCenteredBrand(association)
  layout.centeredText(article.title, { y: hasLogo ? 722 : 738, size: 18, font: 'F2', color: COLOR.heading })
  layout.centeredText(spaceTitle, { y: hasLogo ? 704 : 720, size: 11, color: COLOR.muted })
  layout.y = hasLogo ? 676 : 692

  if (article.summary) {
    paragraph(layout, article.summary, { left: contentLeft }, { italic: true, color: COLOR.muted, size: 10.5 })
    layout.y -= 6
  }
  drawArticleMeta(layout, article)

  renderMarkdown(layout, article, images)

  return layout.finish(footerLabel(association, article.title))
}

export function buildWikiSpacePdf(params: {
  spaceTitle: string
  spaceDescription: string
  articles: WikiPdfArticle[]
  association: AssociationProfileRow | null
  logo?: { mimeType: string, data: Buffer } | null
  images?: WikiPdfImages
}) {
  const { spaceTitle, spaceDescription, articles, association, logo = null, images = new Map() } = params
  const layout = createPdfDocumentLayout({ logo })

  const hasLogo = layout.drawCenteredBrand(association)
  layout.centeredText(spaceTitle, { y: hasLogo ? 722 : 738, size: 18, font: 'F2', color: COLOR.heading })
  layout.centeredText('Wiki-Handbuch', { y: hasLogo ? 704 : 720, size: 11, color: COLOR.muted })
  layout.y = hasLogo ? 676 : 692

  if (spaceDescription) {
    paragraph(layout, spaceDescription, { left: contentLeft }, { italic: true, color: COLOR.muted, size: 10.5 })
    layout.y -= 6
  }

  heading(layout, 2, plainRuns('Inhalt'))
  for (const article of articles) {
    block(
      layout,
      plainRuns(article.title, { color: article.depth ? COLOR.body : COLOR.heading, bold: !article.depth }),
      { left: contentLeft + (article.depth * LIST_INDENT) },
      { hangingLabel: '•', hangingColor: COLOR.faint },
    )
  }

  if (!articles.length) {
    paragraph(layout, 'Dieser Bereich enthält keine Artikel, die du sehen darfst.', { left: contentLeft }, { color: COLOR.muted })
  }

  for (const article of articles) {
    layout.startContinuationPage()
    heading(layout, 1, plainRuns(article.title))
    if (article.summary) {
      paragraph(layout, article.summary, { left: contentLeft }, { italic: true, color: COLOR.muted })
      layout.y -= 4
    }
    drawArticleMeta(layout, article)
    renderMarkdown(layout, article, images)
  }

  return layout.finish(footerLabel(association, spaceTitle))
}

export function wikiPdfFileName(title: string) {
  const umlauts: Record<string, string> = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' }
  const safe = title
    .replace(/[äöüÄÖÜß]/g, char => umlauts[char] ?? char)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${safe || 'wiki-artikel'}.pdf`
}
