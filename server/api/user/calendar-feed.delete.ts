import { defineEventHandler } from 'h3'
import { requireAuth } from '~/server/utils/api/guards'
import { revokeCalendarToken } from '~/server/utils/calendarToken'
import { withAuditTransaction } from '~/server/utils/db'

export type DeleteCalendarFeedResponse = { ok: true } | { ok: false, error: string }

/** Revokes the caller's calendar feed URL (SEC-24). Only needs a session: revoking is always allowed. */
export default defineEventHandler(async (event): Promise<DeleteCalendarFeedResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  await withAuditTransaction(current.user, conn => revokeCalendarToken(current.user.id, conn))
  return { ok: true }
})
