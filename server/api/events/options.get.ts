import { defineEventHandler } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { isAnyEventOrganizer, loadEventOptions } from '~/server/utils/events'
import type { EventCostCentreOption, EventMemberOption, EventSphereOption, EventSubdivisionOption } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface GetEventOptionsSuccess {
  ok: true
  members: EventMemberOption[]
  subdivisions: EventSubdivisionOption[]
  costCentres: EventCostCentreOption[]
  spheres: EventSphereOption[]
}

interface GetEventOptionsError {
  ok: false
  error: string
}

export type GetEventOptionsResponse = GetEventOptionsSuccess | GetEventOptionsError

export default defineEventHandler(async (event): Promise<GetEventOptionsResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  if (!hasPermission(current.user, ['events.access', 'events.view', 'events.shifts.signup']) && !await isAnyEventOrganizer(current.user.id)) {
    return { ok: false, error: 'Not authorized' }
  }

  try {
    const options = await loadEventOptions()
    return {
      ok: true,
      members: options.members,
      subdivisions: options.subdivisions,
      costCentres: options.costCentres,
      spheres: options.spheres,
    }
  } catch (err: any) {
    return internalError('Failed to load event options', err)
  }
})
