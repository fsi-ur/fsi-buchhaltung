import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import { hmacToken, makeToken } from '~/server/utils/auth'
import unsubscribeGet from '~/server/api/notifications/unsubscribe.get'
import unsubscribePost from '~/server/api/notifications/unsubscribe.post'
import { resetDatabase } from '../helpers/db'
import { createMember, resetFixtureCounter } from '../helpers/fixtures'
import { callHandler } from '../helpers/handler'

async function preferenceRows(memberId: number) {
  return query<any[]>(`SELECT * FROM notification_preferences WHERE subject_type = 'member' AND subject_id = ?`, [memberId])
}

// SEC-26: GET only asks, POST unsubscribes.
describe('e-mail unsubscribe', () => {
  let token: string
  let memberId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    memberId = await createMember()
    const notification = await query<any>(
      `INSERT INTO notifications (type_key, status, scheduled_for, created_at, recipient_rule) VALUES ('custom.message', 'sent', '2026-01-01 10:00:00', '2026-01-01 10:00:00', '{}')`,
    )
    token = makeToken()
    await query(
      `INSERT INTO notification_deliveries (notification_id, member_id, channel, status, unsubscribe_token) VALUES (?, ?, 'email', 'sent', ?)`,
      [Number(notification.insertId), memberId, hmacToken(token)],
    )
  })

  it('a GET (link preview, mail scanner) changes nothing', async () => {
    const { result } = await callHandler<string>(unsubscribeGet, { path: `/api/notifications/unsubscribe?token=${token}` })
    expect(result).toContain('<form method="post">')
    expect(await preferenceRows(memberId)).toHaveLength(0)
  })

  it('the confirmation POST and the RFC 8058 one-click POST unsubscribe', async () => {
    const form = await callHandler<string>(unsubscribePost, {
      method: 'POST',
      path: '/api/notifications/unsubscribe',
      body: `token=${token}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(form.result).not.toContain('ungültig')
    expect(await preferenceRows(memberId)).toHaveLength(1)

    await query('DELETE FROM notification_preferences')
    await callHandler<string>(unsubscribePost, {
      method: 'POST',
      path: `/api/notifications/unsubscribe?token=${token}`,
      body: 'List-Unsubscribe=One-Click',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(await preferenceRows(memberId)).toHaveLength(1)
  })
})
