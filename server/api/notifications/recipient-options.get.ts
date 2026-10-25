import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { query } from '~/server/utils/db'
import { getNotificationSettings } from '~/server/utils/notifications/settings'
import { appTodayLocalDate } from '~/server/utils/time'
import { addDaysToLocalDate } from '~/shared/time'
import type { NotificationChannelKey } from '~/config/notificationChannels'

interface RecipientOptionsSuccess {
  ok: true
  members: Array<{ id: number, name: string, hasAccount: boolean }>
  subdivisions: Array<{ id: number, name: string }>
  users: Array<{ id: number, username: string }>
  /** Events with shifts whose plan can go along with the message — upcoming and the last 30 days. */
  shiftPlanEvents: Array<{ id: number, name: string, startsAt: string }>
  channelsEnabled: Record<NotificationChannelKey, boolean>
}
interface RecipientOptionsError { ok: false, error: string }
export type GetNotificationRecipientOptionsResponse = RecipientOptionsSuccess | RecipientOptionsError

export default defineEventHandler(async (event): Promise<GetNotificationRecipientOptionsResponse> => {
  const current = await requirePermission(event, 'notifications.send')
  if (!current.ok) return current

  const settings = await getNotificationSettings()

  const recentFrom = addDaysToLocalDate(await appTodayLocalDate(), -30)

  const [memberRows, subdivisionRows, userRows, eventRows] = await Promise.all([
    query<Array<{ id: number, first_name: string, last_name: string, account: number | null }>>(
      `SELECT id, first_name, last_name, account FROM members WHERE status != 'left' ORDER BY last_name, first_name`,
    ),
    query<Array<{ id: number, name: string }>>(
      `SELECT id, name FROM subdivisions WHERE is_active = 1 ORDER BY name`,
    ),
    query<Array<{ id: number, username: string }>>(
      `SELECT id, username FROM users WHERE is_active = 1 ORDER BY username`,
    ),
    query<Array<{ id: number, name: string, starts_at: string }>>(
      `SELECT e.id, e.name, e.starts_at
       FROM events e
       WHERE e.ends_at >= ? AND EXISTS (SELECT 1 FROM event_shift_slots ess WHERE ess.event_id = e.id)
       ORDER BY e.starts_at`,
      [`${recentFrom} 00:00:00`],
    ),
  ])

  return {
    ok: true,
    members: memberRows.map(row => ({ id: row.id, name: `${row.first_name} ${row.last_name}`, hasAccount: row.account !== null })),
    subdivisions: subdivisionRows.map(row => ({ id: row.id, name: row.name })),
    users: userRows.map(row => ({ id: row.id, username: row.username })),
    shiftPlanEvents: eventRows.map(row => ({ id: Number(row.id), name: row.name, startsAt: row.starts_at })),
    channelsEnabled: settings.channels_enabled,
  }
})
