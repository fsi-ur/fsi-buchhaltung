import { defineEventHandler, getQuery, setHeader, setResponseStatus } from 'h3'
import { requireApiKey } from '~/server/utils/apiKeys'
import { loadPublicEvents, parsePublicEventsQuery } from '~/server/utils/eventWebsite'
import { getAppTimeZone } from '~/server/utils/time'
import { nowLocalDateTime } from '~/shared/time'
import type { PublicEvent } from '~/types/event'

interface GetPublicEventsSuccess {
  ok: true
  /** IANA zone the `…Local` fields are in. */
  timeZone: string
  events: PublicEvent[]
}

interface GetPublicEventsError {
  ok: false
  error: string
}

export type GetPublicEventsResponse = GetPublicEventsSuccess | GetPublicEventsError

export default defineEventHandler(async (event): Promise<GetPublicEventsResponse> => {
  setHeader(event, 'Cache-Control', 'no-store')

  const auth = await requireApiKey(event)
  if (!auth.ok) return auth

  try {
    const timeZone = await getAppTimeZone()
    const now = nowLocalDateTime(timeZone)

    const parsed = parsePublicEventsQuery(getQuery(event), now)
    if (!parsed.ok) {
      setResponseStatus(event, 400)
      return parsed
    }

    const events = await loadPublicEvents(parsed.query, now, timeZone)
    return { ok: true, timeZone, events }
  } catch (err: any) {
    setResponseStatus(event, 500)
    return { ok: false, error: 'Failed to load events' }
  }
})
