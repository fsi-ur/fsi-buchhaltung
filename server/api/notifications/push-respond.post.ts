import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { internalError } from '~/server/utils/api/errors'
import { getUserPermissions, getUserPositionIds, getUserRoleIds } from '~/server/utils/permissions'
import { getMemberIdForUser } from '~/server/utils/appointments/visibility'
import { saveAppointmentResponse, VALID_APPOINTMENT_RESPONSES } from '~/server/utils/appointments/responses'
import { verifyPushResponseToken } from '~/server/utils/notifications/pushResponse'
import type { AppointmentResponseValue } from '~/types/appointment'

interface PushRespondBody {
  token?: string
  response?: AppointmentResponseValue
}

/**
 * Called by the service worker when an answer button of an appointment push notification is
 * pressed. Authenticated by the signed token in the notification instead of the session cookie —
 * the app is usually not open, and the session may long have expired. The token answers exactly
 * one date for one member; everything else is checked against the current state, the same way the
 * calendar's answer form does.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<PushRespondBody>(event).catch(() => null)
  const claims = verifyPushResponseToken(body?.token)
  if (!claims) return { ok: false as const, error: 'Der Link ist ungültig oder abgelaufen.' }
  if (!body?.response || !VALID_APPOINTMENT_RESPONSES.includes(body.response)) {
    return { ok: false as const, error: 'Ungültige Antwort.' }
  }

  const [account] = await query<Array<{ id: number, username: string, is_active: number, must_change_password: number }>>(
    `SELECT id, username, is_active, must_change_password FROM users WHERE id = ? LIMIT 1`,
    [claims.userId],
  )
  if (!account || !Number(account.is_active) || Number(account.must_change_password)) {
    return { ok: false as const, error: 'Not authorized' }
  }

  const roles = await getUserRoleIds(claims.userId)
  const positionIds = await getUserPositionIds(claims.userId)
  const permissions = await getUserPermissions(claims.userId, roles, positionIds)
  if (!permissions.includes('calendar.view')) return { ok: false as const, error: 'Not authorized' }

  // The account may have been linked to a different member since the notification was sent.
  if (await getMemberIdForUser(claims.userId) !== claims.memberId) {
    return { ok: false as const, error: 'Not authorized' }
  }

  try {
    return await withAuditTransaction({ id: claims.userId, username: String(account.username) }, conn => saveAppointmentResponse({
      appointmentId: claims.appointmentId,
      memberId: claims.memberId,
      occurrenceDate: claims.occurrenceDate,
      response: body.response!,
      applyToSeries: false,
    }, conn))
  } catch (err: any) {
    return internalError('Deine Antwort konnte nicht gespeichert werden', err)
  }
})
