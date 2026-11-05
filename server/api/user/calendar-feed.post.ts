import { defineEventHandler, getRequestHost, getRequestProtocol } from 'h3'
import { generateCalendarToken } from '~/server/utils/calendarToken'
import { withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'

interface PostCalendarFeedSuccess {
  ok: true
  url: string
}

interface PostCalendarFeedError {
  ok: false
  error: string
}

export type PostCalendarFeedResponse = PostCalendarFeedSuccess | PostCalendarFeedError

export default defineEventHandler(async (event): Promise<PostCalendarFeedResponse> => {
  const current = await requirePermission(event, 'calendar.view', { touch: false })
  if (!current.ok) return current

  const rawToken = await withAuditTransaction(current.user, conn => generateCalendarToken(current.user.id, conn))

  const protocol = getRequestProtocol(event)
  const host = getRequestHost(event)
  const basePath = (process.env.APP_BASE_URL || '/').replace(/\/+$/, '')
  const url = `${protocol}://${host}${basePath}/api/calendar/${rawToken}.ics`

  return { ok: true, url }
})
