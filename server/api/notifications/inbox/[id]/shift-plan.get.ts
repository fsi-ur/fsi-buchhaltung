import { defineEventHandler, setHeader } from 'h3'
import { requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { query } from '~/server/utils/db'
import { loadCurrentMemberIdForUser } from '~/server/utils/eventShifts'
import { getNotificationSettings } from '~/server/utils/notifications/settings'
import { createShiftPlanRenderer, shiftPlanRequestFor } from '~/server/utils/notifications/shiftPlan'
import type { NotificationTypeKey } from '~/config/notificationTypes'

/**
 * The personal shift plan of one inbox entry — the in-app counterpart of the PDF the e-mail carries.
 * Access follows the delivery, not the event permissions: whoever was sent the notification may see
 * the plan it came with, rendered live with their own shifts highlighted.
 */
export default defineEventHandler(async (event) => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const deliveryId = getNumericRouteParam(event)
  if (!deliveryId) return { ok: false, error: 'Invalid id' }

  const [row] = await query<Array<{ type_key: NotificationTypeKey, payload: string | null }>>(
    `SELECT n.type_key, n.payload
     FROM notification_deliveries nd
     JOIN notifications n ON n.id = nd.notification_id
     WHERE nd.id = ? AND nd.user_id = ? AND nd.channel = 'in_app'
     LIMIT 1`,
    [deliveryId, current.user.id],
  )
  if (!row) return { ok: false, error: 'Nicht gefunden' }

  const request = shiftPlanRequestFor(row.type_key, row.payload ? JSON.parse(row.payload) : null, await getNotificationSettings())
  if (!request) return { ok: false, error: 'Zu dieser Benachrichtigung gibt es keinen Schichtplan.' }

  const renderer = await createShiftPlanRenderer(request)
  if (!renderer) return { ok: false, error: 'Die Veranstaltung existiert nicht mehr.' }

  const pdf = renderer.render(await loadCurrentMemberIdForUser(current.user.id))

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${renderer.fileName}"`)
  return pdf
})
