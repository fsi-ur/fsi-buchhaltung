import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { withAuditTransaction } from '~/server/utils/db'
import { resetAppTimeZoneCache, saveAppTimeZone } from '~/server/utils/time'
import { isValidTimeZone } from '~/shared/time'

interface SaveAppTimeZoneSuccess {
  ok: true
  timeZone: string
}

interface SaveAppTimeZoneError {
  ok: false
  error: string
}

type SaveAppTimeZoneResponse = SaveAppTimeZoneSuccess | SaveAppTimeZoneError

export default defineEventHandler(async (event): Promise<SaveAppTimeZoneResponse> => {
  const current = await requirePermission(event, 'settings.app.access', { touch: false })
  if (!current.ok) return current

  const body = await readBody<{ timeZone?: unknown }>(event)
  const timeZone = typeof body?.timeZone === 'string' ? body.timeZone.trim() : ''
  if (!isValidTimeZone(timeZone)) return { ok: false, error: 'Ungültige Zeitzone' }

  await withAuditTransaction(current.user, async conn => saveAppTimeZone(timeZone, conn))
  // Saved inside the transaction — drop the cache again now that it is committed.
  resetAppTimeZoneCache()
  return { ok: true, timeZone }
})
