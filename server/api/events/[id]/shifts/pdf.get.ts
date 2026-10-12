import { defineEventHandler, getQuery, setHeader } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { query } from '~/server/utils/db'
import { isEventOrganizer } from '~/server/utils/events'
import { loadCurrentMemberIdForUser, loadEventShiftSlots, loadEventShiftTypeDescriptions } from '~/server/utils/eventShifts'
import { buildEventShiftPlanPdf, type ShiftPlanEventInfo } from '~/server/utils/eventShiftsPdf'
import { getAssociationLogoForInvoice, getAssociationProfileForInvoice } from '~/server/utils/invoices'

export default defineEventHandler(async (event) => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const eventId = getNumericRouteParam(event)
  if (!eventId) return { ok: false, error: 'Invalid event id' }

  const organizer = await isEventOrganizer(current.user.id, eventId)
  if (!hasPermission(current.user, ['events.access', 'events.view', 'events.shifts.signup']) && !organizer) {
    return { ok: false, error: 'Not authorized' }
  }

  const eventRows = await query<Array<{ name: string, starts_at: string, ends_at: string, location: string | null }>>(
    `SELECT name, starts_at, ends_at, location
     FROM events
     WHERE id = ?
     LIMIT 1`,
    [eventId],
  )
  if (!eventRows[0]) return { ok: false, error: 'Event not found' }

  const formatDateTime = (value: string) => String(value).trim().replace(' ', 'T').slice(0, 16)

  const eventInfo: ShiftPlanEventInfo = {
    name: String(eventRows[0].name),
    starts_at: formatDateTime(eventRows[0].starts_at),
    ends_at: formatDateTime(eventRows[0].ends_at),
    location: eventRows[0].location !== null && eventRows[0].location !== undefined ? String(eventRows[0].location) : null,
  }

  const shifts = await loadEventShiftSlots(eventId)
  const typeDescriptions = await loadEventShiftTypeDescriptions(eventId)
  const includeDescriptions = String(getQuery(event).descriptions ?? '') === '1'
  const highlightOwn = String(getQuery(event).own ?? '') === '1'
  const highlightMemberId = highlightOwn ? await loadCurrentMemberIdForUser(current.user.id) : null

  const association = await getAssociationProfileForInvoice()

  let logo: { mimeType: string, data: Buffer } | null = null
  try {
    const attachedLogo = await getAssociationLogoForInvoice()
    if (attachedLogo) {
      logo = { mimeType: attachedLogo.file.mime_type, data: attachedLogo.data }
    }
  } catch {
    logo = null
  }

  const pdf = buildEventShiftPlanPdf({ event: eventInfo, shifts, typeDescriptions, includeDescriptions, highlightMemberId, association, logo })

  const safeName = eventInfo.name
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Veranstaltung'
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="Schichtplan_${safeName}.pdf"`)
  return pdf
})
