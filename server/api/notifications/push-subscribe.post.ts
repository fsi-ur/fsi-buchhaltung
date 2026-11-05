import { defineEventHandler, getRequestHeader, readBody } from 'h3'
import crypto from 'node:crypto'
import { requireAuth } from '~/server/utils/api/guards'
import { query } from '~/server/utils/db'
import { localWallClockNow } from '~/server/utils/notifications/time'
import { isAllowedPushEndpoint } from '~/server/utils/notifications/pushEndpoints'

interface PushSubscribeSuccess { ok: true }
interface PushSubscribeError { ok: false, error: string }
export type PushSubscribeResponse = PushSubscribeSuccess | PushSubscribeError

function sameSecret(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export default defineEventHandler(async (event): Promise<PushSubscribeResponse> => {
  const current = await requireAuth(event, { touch: false })
  if (!current.ok) return current

  const body = await readBody<{ endpoint?: string, keys?: { p256dh?: string, auth?: string } }>(event)
  const endpoint = String(body?.endpoint || '').trim()
  const p256dh = String(body?.keys?.p256dh || '').trim()
  const auth = String(body?.keys?.auth || '').trim()
  if (!endpoint || !p256dh || !auth) return { ok: false, error: 'Ungültige Push-Subscription' }
  if (endpoint.length > 500 || p256dh.length > 255 || auth.length > 255) return { ok: false, error: 'Ungültige Push-Subscription' }
  // Only real push services: the server POSTs to this URL (SEC-20).
  if (!isAllowedPushEndpoint(endpoint)) return { ok: false, error: 'Dieser Push-Dienst wird nicht unterstützt.' }

  const userAgent = (getRequestHeader(event, 'user-agent') || '').slice(0, 255) || null

  const [existing] = await query<Array<{ id: number, user_id: number, p256dh: string, auth: string }>>(
    `SELECT id, user_id, p256dh, auth FROM notification_push_subscriptions WHERE endpoint = ? LIMIT 1`,
    [endpoint],
  )

  if (existing) {
    // A device moves to whoever subscribes on it — but only with proof of possession: the browser
    // that owns the endpoint is the only one that knows its keys (SEC-20).
    const sameUser = Number(existing.user_id) === Number(current.user.id)
    if (!sameUser && !(sameSecret(existing.p256dh, p256dh) && sameSecret(existing.auth, auth))) {
      return { ok: false, error: 'Ungültige Push-Subscription' }
    }
    await query(
      `UPDATE notification_push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ? WHERE id = ?`,
      [current.user.id, p256dh, auth, userAgent, existing.id],
    )
    return { ok: true }
  }

  await query(
    `INSERT INTO notification_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [current.user.id, endpoint, p256dh, auth, userAgent, await localWallClockNow()],
  )

  return { ok: true }
})
