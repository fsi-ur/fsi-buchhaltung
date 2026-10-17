import { defineEventHandler } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { loadEventWebsiteSettings } from '~/server/utils/eventWebsite'
import type { EventWebsiteSettings } from '~/types/event'

interface GetEventWebsiteSuccess {
  ok: true
  website: EventWebsiteSettings
  canPublish: boolean
}

interface GetEventWebsiteError {
  ok: false
  error: string
}

export type GetEventWebsiteResponse = GetEventWebsiteSuccess | GetEventWebsiteError

export default defineEventHandler(async (event): Promise<GetEventWebsiteResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  if (!hasPermission(current.user, ['events.view', 'events.publish'])) {
    return { ok: false, error: 'Not authorized' }
  }

  const eventId = getNumericRouteParam(event)
  if (!eventId) return { ok: false, error: 'Invalid event id' }

  try {
    const website = await loadEventWebsiteSettings(eventId)
    if (!website) return { ok: false, error: 'Event not found' }

    return { ok: true, website, canPublish: hasPermission(current.user, 'events.publish') }
  } catch (err: any) {
    return { ok: false, error: `Failed to load website settings: ${err}` }
  }
})
