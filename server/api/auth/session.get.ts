import { defineEventHandler } from 'h3'
import { getCurrentUserFromEvent } from '~/server/utils/sessionGuard'
import type { SessionResponse } from '~/server/utils/sessionGuard'
import { getUserSubdivisionPermissions } from '~/server/utils/subdivisionLeadership'

export default defineEventHandler(async (event): Promise<SessionResponse> => {
  const session = await getCurrentUserFromEvent(event, true)
  if (!session.ok) return session

  return {
    ...session,
    user: {
      ...session.user,
      subdivision_permissions: await getUserSubdivisionPermissions(Number(session.user.id)),
    },
  }
})