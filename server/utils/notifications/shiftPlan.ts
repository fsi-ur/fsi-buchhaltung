import { query } from '~/server/utils/db'
import { loadEventShiftSlots, loadEventShiftTypeDescriptions } from '~/server/utils/eventShifts'
import { buildEventShiftPlanPdf, type ShiftPlanEventInfo } from '~/server/utils/eventShiftsPdf'
import { getAssociationLogoForInvoice, getAssociationProfileForInvoice } from '~/server/utils/invoices'
import { SHIFT_PLAN_PDF_TYPES, type NotificationTypeKey } from '~/config/notificationTypes'
import type { NotificationSettings } from '~/types/notification'
import type { MailAttachment } from '~/server/utils/attachments'
import type { DbConn } from '~/server/utils/notifications/types'

export interface ShiftPlanRequest {
  eventId: number
  includeDescriptions: boolean
}

/**
 * Whether a notification comes with the event's shift plan: a custom message names its event
 * (`shift_plan_event_id`), the shift types follow the per-type switch in the settings.
 */
export function shiftPlanRequestFor(
  typeKey: NotificationTypeKey,
  payload: Record<string, any> | null,
  settings: NotificationSettings,
): ShiftPlanRequest | null {
  if (!payload) return null

  const customEventId = Number(payload.shift_plan_event_id)
  if (typeKey === 'custom.message') {
    return Number.isInteger(customEventId) && customEventId > 0
      ? { eventId: customEventId, includeDescriptions: Boolean(payload.shift_plan_descriptions) }
      : null
  }

  if (!SHIFT_PLAN_PDF_TYPES.includes(typeKey)) return null
  const option = settings.shift_plan_pdf[typeKey]
  const eventId = Number(payload.event_id)
  if (!option || !Number.isInteger(eventId) || eventId <= 0) return null
  return { eventId, includeDescriptions: option.include_descriptions }
}

/** File name used for the download and the mail attachment — umlauts spelled out, nothing else odd. */
export function shiftPlanFileName(eventName: string): string {
  const safeName = eventName
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Veranstaltung'
  return `Schichtplan_${safeName}.pdf`
}

export interface ShiftPlanRenderer {
  eventName: string
  fileName: string
  /** The plan with `memberId`'s shifts highlighted (none when null). */
  render(memberId: number | null): Buffer
}

/**
 * Loads everything the shift plan needs once, so a notification to fifty helpers renders fifty
 * personalised PDFs from one set of queries. null when the event no longer exists.
 */
export async function createShiftPlanRenderer(request: ShiftPlanRequest, conn?: DbConn): Promise<ShiftPlanRenderer | null> {
  const [eventRow] = await query<Array<{ name: string, starts_at: string, ends_at: string, location: string | null }>>(
    `SELECT name, starts_at, ends_at, location
     FROM events
     WHERE id = ?
     LIMIT 1`,
    [request.eventId],
    conn,
  )
  if (!eventRow) return null

  const formatDateTime = (value: string) => String(value).trim().replace(' ', 'T').slice(0, 16)

  const eventInfo: ShiftPlanEventInfo = {
    name: String(eventRow.name),
    starts_at: formatDateTime(eventRow.starts_at),
    ends_at: formatDateTime(eventRow.ends_at),
    location: eventRow.location !== null && eventRow.location !== undefined ? String(eventRow.location) : null,
  }

  const [shifts, typeDescriptions, association] = await Promise.all([
    loadEventShiftSlots(request.eventId, conn),
    loadEventShiftTypeDescriptions(request.eventId, conn),
    getAssociationProfileForInvoice(conn),
  ])

  let logo: { mimeType: string, data: Buffer } | null = null
  try {
    const attachedLogo = await getAssociationLogoForInvoice(conn)
    if (attachedLogo) logo = { mimeType: attachedLogo.file.mime_type, data: attachedLogo.data }
  } catch {
    logo = null
  }

  return {
    eventName: eventInfo.name,
    fileName: shiftPlanFileName(eventInfo.name),
    render: memberId => buildEventShiftPlanPdf({
      event: eventInfo,
      shifts,
      typeDescriptions,
      includeDescriptions: request.includeDescriptions,
      highlightMemberId: memberId,
      association,
      logo,
    }),
  }
}

export function shiftPlanMailAttachment(renderer: ShiftPlanRenderer, memberId: number | null): MailAttachment {
  return { filename: renderer.fileName, content: renderer.render(memberId), contentType: 'application/pdf' }
}
