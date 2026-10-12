import {
  estimateTextWidth,
  wrapTextByWidth,
} from '~/server/utils/pdf'
import { createPdfDocumentLayout, PDF_LAYOUT } from '~/server/utils/pdfLayout'
import type { AssociationProfileRow } from '~/types/association'
import type { EventShiftSlot, EventShiftTypeDescriptions } from '~/types/event'
import { weekdayOfLocalDate } from '~/shared/time'

export interface ShiftPlanEventInfo {
  name: string
  starts_at: string
  ends_at: string
  location: string | null
}

const WEEKDAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function formatDayLabel(dayKey: string) {
  const match = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return dayKey

  return `${WEEKDAY_LABELS[weekdayOfLocalDate(dayKey)]}, ${match[3]}.${match[2]}.${match[1]}`
}

function formatTime(value: string) {
  return value.slice(11, 16) || value
}

function formatDateTimeLabel(value: string) {
  const dayKey = value.slice(0, 10)
  return `${formatDayLabel(dayKey)} ${formatTime(value)}`
}

function formatRangeLabel(startsAt: string, endsAt: string) {
  if (!startsAt || !endsAt) return ''
  if (startsAt.slice(0, 10) === endsAt.slice(0, 10)) {
    return `${formatTime(startsAt)} - ${formatTime(endsAt)} Uhr`
  }

  return `${formatDateTimeLabel(startsAt)} - ${formatDateTimeLabel(endsAt)}`
}

function normalizeShiftTypeName(name: string) {
  return name.trim().toLocaleLowerCase()
}

interface MemberNameSegment {
  text: string
  bold: boolean
}

/** Lays out member names as wrappable atomic units (never splitting a name mid-word) so the highlighted member's name can be bolded individually. */
function layoutMemberNameLines(
  members: EventShiftSlot['members'],
  highlightMemberId: number | null,
  maxWidth: number,
  fontSize: number,
): MemberNameSegment[][] {
  const lines: MemberNameSegment[][] = []
  let currentLine: MemberNameSegment[] = []
  let currentWidth = 0

  members.forEach((member, index) => {
    const isLast = index === members.length - 1
    const text = isLast ? member.full_name : `${member.full_name}, `
    const bold = highlightMemberId !== null && member.id === highlightMemberId
    const width = estimateTextWidth(text, fontSize, bold)

    if (currentLine.length && currentWidth + width > maxWidth) {
      lines.push(currentLine)
      currentLine = []
      currentWidth = 0
    }

    currentLine.push({ text, bold })
    currentWidth += width
  })

  if (currentLine.length) lines.push(currentLine)
  if (!lines.length) lines.push([{ text: '-', bold: false }])

  return lines
}

function groupShiftsByTime(shifts: EventShiftSlot[]) {
  const groups: Array<{ startsAt: string, endsAt: string, shifts: EventShiftSlot[] }> = []

  for (const shift of shifts) {
    const last = groups[groups.length - 1]
    if (last && last.startsAt === shift.starts_at && last.endsAt === shift.ends_at) {
      last.shifts.push(shift)
      continue
    }
    groups.push({ startsAt: shift.starts_at, endsAt: shift.ends_at, shifts: [shift] })
  }

  return groups
}

/** Maps each shift-type name present among the given shifts to its display label and persisted type description, if any. */
function buildTypeLabels(shifts: EventShiftSlot[], typeDescriptions: EventShiftTypeDescriptions) {
  const labelsByKey = new Map<string, { label: string, description: string }>()

  for (const shift of shifts) {
    const key = normalizeShiftTypeName(shift.name)
    if (labelsByKey.has(key)) continue

    const description = typeDescriptions[key]?.trim() ?? ''
    if (description) labelsByKey.set(key, { label: shift.name.trim(), description })
  }

  return labelsByKey
}

export function buildEventShiftPlanPdf(params: {
  event: ShiftPlanEventInfo
  shifts: EventShiftSlot[]
  typeDescriptions: EventShiftTypeDescriptions
  includeDescriptions: boolean
  highlightMemberId?: number | null
  association: AssociationProfileRow | null
  logo?: { mimeType: string, data: Buffer } | null
}) {
  const { event, shifts, typeDescriptions, includeDescriptions, highlightMemberId = null, association, logo = null } = params
  const layout = createPdfDocumentLayout({ logo })

  const { contentLeft, contentRight } = PDF_LAYOUT

  const timeLeft = contentLeft + 4
  const nameLeft = 165
  const staffedRight = 355
  const membersLeft = 368
  const nameWidth = staffedRight - 42 - nameLeft
  const membersWidth = contentRight - 4 - membersLeft

  let tableHeaderDrawn = false

  const drawTableHeader = () => {
    layout.page.lines.push(
      { x1: contentLeft, y1: layout.y, x2: contentRight, y2: layout.y, width: 0.8 },
      { x1: contentLeft, y1: layout.y - 17, x2: contentRight, y2: layout.y - 17, width: 0.8 },
    )
    layout.page.texts.push(
      { x: timeLeft, y: layout.y - 11, size: 9.5, text: 'Zeit', font: 'F2' },
      { x: nameLeft, y: layout.y - 11, size: 9.5, text: 'Schicht', font: 'F2' },
      { x: staffedRight, y: layout.y - 11, size: 9.5, text: 'Besetzt', font: 'F2', align: 'right' },
      { x: membersLeft, y: layout.y - 11, size: 9.5, text: 'Mitglieder', font: 'F2' },
    )
    layout.y -= 24
  }
  layout.onContinuationPage(() => {
    drawTableHeader()
    tableHeaderDrawn = true
  })

  const renderDayHeading = (label: string) => {
    layout.ensureSpace(26)
    layout.page.rects.push({
      x: contentLeft,
      y: layout.y - 20,
      width: contentRight - contentLeft,
      height: 20,
      fill: true,
      gray: 0.9,
    })
    layout.page.texts.push({ x: timeLeft, y: layout.y - 14, size: 10, text: label, font: 'F2' })
    layout.y -= 20
  }

  const renderTimeGroupHeader = (label: string) => {
    layout.ensureSpace(20)
    layout.page.rects.push({
      x: contentLeft,
      y: layout.y - 16,
      width: contentRight - contentLeft,
      height: 16,
      fill: true,
      gray: 0.95,
    })
    layout.page.texts.push({ x: timeLeft, y: layout.y - 11.5, size: 9, text: label, font: 'F2', gray: 0.25 })
    layout.y -= 16
  }

  const renderShift = (shift: EventShiftSlot) => {
    const nameLines = wrapTextByWidth(shift.name, nameWidth, 9)
    const memberLineSegments = layoutMemberNameLines(shift.members, highlightMemberId, membersWidth, 9)
    const descriptionText = includeDescriptions ? shift.description.trim() : ''
    const descriptionLines = descriptionText
      ? wrapTextByWidth(descriptionText, contentRight - 4 - nameLeft, 8)
      : []

    const contentHeight = (Math.max(nameLines.length, memberLineSegments.length) * 11)
      + (descriptionLines.length ? 2 + (descriptionLines.length * 10) : 0)
    const rowHeight = contentHeight + 7

    layout.ensureSpace(rowHeight)

    const firstBaseline = layout.y - 12

    nameLines.forEach((line, index) => {
      if (!line) return
      layout.page.texts.push({
        x: nameLeft,
        y: firstBaseline - (index * 11),
        size: 9,
        text: line,
        font: 'F2',
      })
    })

    const isFullyStaffed = shift.members.length >= shift.required_people
    layout.page.texts.push({
      x: staffedRight,
      y: firstBaseline,
      size: 9,
      text: `${shift.members.length}/${shift.required_people}`,
      font: 'F2',
      align: 'right',
      gray: isFullyStaffed ? 0.35 : 0,
    })

    memberLineSegments.forEach((lineSegments, lineIndex) => {
      let cursorX = membersLeft
      const segmentY = firstBaseline - (lineIndex * 11)

      lineSegments.forEach((segment) => {
        layout.page.texts.push({
          x: cursorX,
          y: segmentY,
          size: 9,
          text: segment.text,
          font: segment.bold ? 'F2' : 'F1',
          gray: segment.text === '-' ? 0.55 : 0,
        })

        if (segment.bold) {
          const nameOnly = segment.text.replace(/,\s*$/, '')
          layout.page.lines.push({
            x1: cursorX,
            x2: cursorX + estimateTextWidth(nameOnly, 9, true),
            y1: segmentY - 2,
            y2: segmentY - 2,
            width: 1.2,
            gray: 0.3,
          })
        }

        cursorX += estimateTextWidth(segment.text, 9, segment.bold)
      })
    })

    if (descriptionLines.length) {
      const descriptionStartY = firstBaseline - (Math.max(nameLines.length, memberLineSegments.length) * 11) - 1
      descriptionLines.forEach((line, index) => {
        if (!line) return
        layout.page.texts.push({
          x: nameLeft,
          y: descriptionStartY - (index * 10),
          size: 8,
          text: line,
          font: 'F3',
          gray: 0.35,
        })
      })
    }

    layout.page.lines.push({
      x1: contentLeft,
      y1: layout.y - rowHeight,
      x2: contentRight,
      y2: layout.y - rowHeight,
      width: 0.5,
      gray: 0.82,
    })

    layout.y -= rowHeight
  }

  const hasLogo = layout.drawCenteredBrand(association)

  layout.centeredText('Schichtplan', { y: hasLogo ? 722 : 738, size: 18, font: 'F2' })

  const subtitle = event.name.trim() || 'Veranstaltung'
  layout.centeredText(subtitle, { y: hasLogo ? 704 : 720, size: 12, gray: 0.2 })

  const metaParts = [
    `${formatDateTimeLabel(event.starts_at)} - ${formatDateTimeLabel(event.ends_at)}`,
    ...(event.location?.trim() ? [event.location.trim()] : []),
  ]
  const metaLabel = metaParts.join(' · ')
  layout.centeredText(metaLabel, { y: hasLogo ? 690 : 706, size: 9.5, gray: 0.35 })

  layout.y = hasLogo ? 664 : 680

  const sortedShifts = [...shifts].sort((left, right) => {
    return left.starts_at.localeCompare(right.starts_at)
      || left.ends_at.localeCompare(right.ends_at)
      || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })

  const typeLabels: Map<string, { label: string, description: string }> = includeDescriptions
    ? buildTypeLabels(sortedShifts, typeDescriptions)
    : new Map()

  if (typeLabels.size) {
    layout.ensureSpace(18)
    layout.page.texts.push({ x: timeLeft, y: layout.y - 12, size: 10.5, text: 'Aufgaben nach Schichttyp', font: 'F2' })
    layout.y -= 18

    for (const { label, description } of typeLabels.values()) {
      layout.ensureSpace(13)
      layout.page.texts.push({ x: timeLeft, y: layout.y - 10, size: 9, text: label, font: 'F2' })
      layout.y -= 12

      const lines = wrapTextByWidth(description, contentRight - 8 - timeLeft, 8.5)
      const rowHeight = (lines.length * 10) + 4
      layout.ensureSpace(rowHeight)
      lines.forEach((line, index) => {
        layout.page.texts.push({ x: timeLeft + 8, y: layout.y - 9 - (index * 10), size: 8.5, text: line, font: 'F3', gray: 0.35 })
      })
      layout.y -= rowHeight
    }

    layout.y -= 6
  }

  if (!tableHeaderDrawn) drawTableHeader()

  const dayKeys = Array.from(new Set(sortedShifts.map(shift => shift.starts_at.slice(0, 10))))

  for (const dayKey of dayKeys) {
    if (dayKeys.length > 1) renderDayHeading(formatDayLabel(dayKey))
    const dayShifts = sortedShifts.filter(shift => shift.starts_at.slice(0, 10) === dayKey)
    for (const group of groupShiftsByTime(dayShifts)) {
      renderTimeGroupHeader(formatRangeLabel(group.startsAt, group.endsAt))
      for (const shift of group.shifts) renderShift(shift)
    }
  }

  if (!sortedShifts.length) {
    layout.page.texts.push({ x: timeLeft, y: layout.y - 14, size: 10, text: 'Keine Schichten vorhanden.', gray: 0.35 })
  }

  const footerLabel = [association?.short_name || association?.name, `Schichtplan ${subtitle}`]
    .filter(Boolean)
    .join(' · ')

  return layout.finish(footerLabel)
}
