import type { GetAppTimeZoneResponse } from '~/server/api/settings/app/time-zone.get'
import { isValidTimeZone } from '~/shared/time'

/**
 * Loads the association's time zone before the app renders, so no date is ever formatted in the
 * browser's own zone first. Falls back to the default (useAppTimeZone) if the request fails.
 */
export default defineNuxtPlugin(async () => {
  const { setTimeZone } = useAppTimeZone()
  try {
    const res = await $fetch<GetAppTimeZoneResponse>('/api/settings/app/time-zone')
    if (res.ok && isValidTimeZone(res.timeZone)) setTimeZone(res.timeZone)
  } catch {
    // keep the default
  }
})
