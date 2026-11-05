import { defineEventHandler } from 'h3'
import { hasCalendarToken } from '~/server/utils/calendarToken'
import { requirePermission } from '~/server/utils/api/guards'

interface GetCalendarFeedSuccess {
  ok: true
  hasToken: boolean
}

interface GetCalendarFeedError {
  ok: false
  error: string
}

export type GetCalendarFeedResponse = GetCalendarFeedSuccess | GetCalendarFeedError

export default defineEventHandler(async (event): Promise<GetCalendarFeedResponse> => {
  const current = await requirePermission(event, 'calendar.view')
  if (!current.ok) return current

  const hasToken = await hasCalendarToken(current.user.id)
  return { ok: true, hasToken }
})
