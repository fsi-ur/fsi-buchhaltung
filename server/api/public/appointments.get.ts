import { defineEventHandler, getQuery, setHeader, setResponseStatus } from 'h3'
import { requireApiKey } from '~/server/utils/apiKeys'
import { loadPublicAppointments, parsePublicAppointmentsQuery } from '~/server/utils/appointmentWebsite'
import { getAppTimeZone } from '~/server/utils/time'
import { nowLocalDateTime } from '~/shared/time'
import type { PublicAppointment } from '~/types/appointment'

interface GetPublicAppointmentsSuccess {
  ok: true
  /** IANA zone the `…Local` fields are in. */
  timeZone: string
  appointments: PublicAppointment[]
}

interface GetPublicAppointmentsError {
  ok: false
  error: string
}

export type GetPublicAppointmentsResponse = GetPublicAppointmentsSuccess | GetPublicAppointmentsError

/**
 * Read-only feed of the appointments ("Termine") marked "publish on website", one entry per
 * occurrence — recurring series are expanded, cancelled dates are included with `cancelled: true`.
 * Authenticated with an API key from Settings → App → API-Schlüssel (`Authorization: Bearer fsi_…`).
 *
 * Query: `from`/`to` (YYYY-MM-DD, inclusive, app time zone; default: from now until 365 days after
 * today; at most 3660 days), `limit` (default 100, max 500), `order` (`asc` | `desc`, default `asc`).
 */
export default defineEventHandler(async (event): Promise<GetPublicAppointmentsResponse> => {
  setHeader(event, 'Cache-Control', 'no-store')

  const auth = await requireApiKey(event)
  if (!auth.ok) return auth

  try {
    const timeZone = await getAppTimeZone()
    const now = nowLocalDateTime(timeZone)

    const parsed = parsePublicAppointmentsQuery(getQuery(event), now)
    if (!parsed.ok) {
      setResponseStatus(event, 400)
      return parsed
    }

    const appointments = await loadPublicAppointments(parsed.query, now, timeZone)
    return { ok: true, timeZone, appointments }
  } catch {
    setResponseStatus(event, 500)
    return { ok: false, error: 'Failed to load appointments' }
  }
})
