import { defineEventHandler, getRequestHeader, readBody } from 'h3'
import { requireAuth } from '~/server/utils/api/guards'
import { query } from '~/server/utils/db'
import { localWallClockNow } from '~/server/utils/notifications/time'

interface PushSubscribeSuccess { ok: true }
interface PushSubscribeError { ok: false, error: string }
export type PushSubscribeResponse = PushSubscribeSuccess | PushSubscribeError

export default defineEventHandler(async (event): Promise<PushSubscribeResponse> => {
  const current = await requireAuth(event, { touch: false })
  if (!current.ok) return current

  const body = await readBody<{ endpoint?: string, keys?: { p256dh?: string, auth?: string } }>(event)
  const endpoint = String(body?.endpoint || '').trim()
  const p256dh = String(body?.keys?.p256dh || '').trim()
  const auth = String(body?.keys?.auth || '').trim()
  if (!endpoint || !p256dh || !auth) return { ok: false, error: 'Ungültige Push-Subscription' }

  const userAgent = (getRequestHeader(event, 'user-agent') || '').slice(0, 255) || null

  await query(
    `INSERT INTO notification_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent)`,
    [current.user.id, endpoint, p256dh, auth, userAgent, await localWallClockNow()],
  )

  return { ok: true }
})
