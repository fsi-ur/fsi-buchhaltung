import { defineEventHandler } from 'h3'
import { getAppTimeZone } from '~/server/utils/time'

interface GetAppTimeZoneSuccess {
  ok: true
  timeZone: string
}

export type GetAppTimeZoneResponse = GetAppTimeZoneSuccess

/**
 * The zone every DATETIME/DATE of the app is meant in (shared/time.ts). Deliberately readable without
 * a session: the client needs it before anything renders, and it is no more sensitive than the
 * language the UI is in.
 */
export default defineEventHandler(async (): Promise<GetAppTimeZoneResponse> => {
  return { ok: true, timeZone: await getAppTimeZone() }
})
